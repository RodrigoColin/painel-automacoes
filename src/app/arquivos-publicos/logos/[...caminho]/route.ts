/**
 * Serve as logos das empresas — o que antes era o bucket público
 * `logos-empresa` do Supabase.
 *
 * Público de propósito, como era o bucket: a logo aparece em toda tela e não
 * tem nada de sigiloso. Cada envio grava um nome novo, então a resposta pode
 * ser cacheada para sempre.
 */

import { lerArquivo } from "@/lib/armazenamento";

const TIPO_POR_EXTENSAO: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caminho: string[] }> },
) {
  const { caminho } = await params;
  const extensao = caminho.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  const tipo = TIPO_POR_EXTENSAO[extensao];
  if (!tipo) return new Response(null, { status: 404 });

  let conteudo: Buffer | null;
  try {
    conteudo = await lerArquivo("logos-empresa", caminho.join("/"));
  } catch {
    // Caminho que tenta escapar da pasta: some como qualquer inexistente.
    return new Response(null, { status: 404 });
  }
  if (!conteudo) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(conteudo), {
    headers: {
      "Content-Type": tipo,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // SVG é documento, não só imagem: aberto direto no navegador, rodaria
      // script embutido na origem do painel. O Supabase servia de outro
      // domínio; aqui o CSP é que impede isso.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
