/**
 * Arquivos em disco, no lugar do Supabase Storage.
 *
 * Cada "bucket" é uma pasta dentro de `ARMAZENAMENTO_DIR` (na VPS, um volume
 * Docker — ver `docker-compose.yml`), e o caminho dentro dele segue o mesmo
 * formato de antes (`<empresa_id>/<arquivo>`, `<automacao_id>/<arquivo>`).
 *
 * Não há policy aqui: quem chama confere a permissão antes, no DAL — como já
 * era com o cliente admin do Storage. A leitura pública das logos passa pela
 * rota `/arquivos-publicos/logos/...`; os scripts nunca saem do servidor.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type Bucket = "logos-empresa" | "automacao-scripts";

function raiz() {
  // `turbopackIgnore`: o caminho só existe em execução (volume na VPS). Sem o
  // comentário, o build rastreia o projeto inteiro como se o app fosse ler
  // qualquer arquivo dele, e copia tudo para a imagem.
  return path.resolve(/*turbopackIgnore: true*/ process.env.ARMAZENAMENTO_DIR ?? "./armazenamento");
}

/**
 * Caminho absoluto de um objeto, recusando qualquer coisa que escape da
 * pasta do bucket. Os caminhos são montados pelo próprio app, mas a rota
 * pública recebe o seu da URL — ".." ali não pode virar leitura do disco.
 */
function resolver(bucket: Bucket, caminho: string) {
  const pasta = path.join(raiz(), bucket);
  const alvo = path.resolve(pasta, caminho);
  if (!alvo.startsWith(pasta + path.sep)) {
    throw new Error(`Caminho inválido no armazenamento: ${caminho}`);
  }
  return alvo;
}

export async function salvarArquivo(bucket: Bucket, caminho: string, conteudo: Blob | Buffer) {
  const alvo = resolver(bucket, caminho);
  const dados = conteudo instanceof Blob ? Buffer.from(await conteudo.arrayBuffer()) : conteudo;
  await mkdir(path.dirname(alvo), { recursive: true });
  // `wx`: falha se já existir. Cada envio ganha nome novo — sobrescrever no
  // lugar deixaria cache velho no navegador (logos) e não é esperado de
  // nenhum fluxo do painel.
  await writeFile(alvo, dados, { flag: "wx" });
}

/** Conteúdo do arquivo, ou `null` se não existir. */
export async function lerArquivo(bucket: Bucket, caminho: string): Promise<Buffer | null> {
  try {
    return await readFile(resolver(bucket, caminho));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw erro;
  }
}

/** Apaga os arquivos. Um que já não existia não é erro — o objetivo é ele não estar lá. */
export async function removerArquivos(bucket: Bucket, caminhos: string[]) {
  await Promise.all(caminhos.map((caminho) => rm(resolver(bucket, caminho), { force: true })));
}

/** URL pública de uma logo, servida por `app/arquivos-publicos/logos/[...caminho]`. */
export function urlPublicaLogo(caminho: string) {
  return `/arquivos-publicos/logos/${caminho.split("/").map(encodeURIComponent).join("/")}`;
}

/** Caminho no bucket a partir da URL guardada em `empresas.logo_url`; `null` se for de outro formato. */
export function caminhoDaUrlLogo(url: string | null): string | null {
  const marca = "/arquivos-publicos/logos/";
  if (!url?.startsWith(marca)) return null;
  return url.slice(marca.length).split("/").map(decodeURIComponent).join("/");
}
