/**
 * Store das empresas, persistido no navegador.
 *
 * Fica fora do React (padrão `useSyncExternalStore`) porque o estado nasce do
 * `localStorage`: o servidor renderiza o estado inicial e o cliente assume o
 * que está salvo já no primeiro commit, sem descompasso de hidratação.
 * Trocar por chamadas à API quando ela existir.
 */

import {
  type Empresa,
  empresasIniciais,
  novaEmpresaId,
} from "@/lib/empresas";

const CHAVE_EMPRESAS = "painel:empresas";
const CHAVE_SELECIONADA = "painel:empresa-selecionada";

export type EstadoEmpresas = {
  empresas: Empresa[];
  selecionadaId: string;
};

const ESTADO_INICIAL: EstadoEmpresas = {
  empresas: empresasIniciais,
  selecionadaId: empresasIniciais[0].id,
};

/** Snapshot precisa ser estável entre renders — só troca quando o estado muda. */
let cache: EstadoEmpresas | null = null;
const ouvintes = new Set<() => void>();

function ler(): EstadoEmpresas {
  try {
    const salvas = localStorage.getItem(CHAVE_EMPRESAS);
    const empresas = salvas ? (JSON.parse(salvas) as Empresa[]) : null;
    const lista = empresas?.length ? empresas : empresasIniciais;
    const id = localStorage.getItem(CHAVE_SELECIONADA);

    return {
      empresas: lista,
      selecionadaId: lista.some((e) => e.id === id) ? id! : lista[0].id,
    };
  } catch {
    // Armazenamento indisponível ou corrompido: segue com os dados padrão.
    return ESTADO_INICIAL;
  }
}

function notificar() {
  for (const ouvinte of ouvintes) ouvinte();
}

function escrever(estado: EstadoEmpresas) {
  cache = estado;
  try {
    localStorage.setItem(CHAVE_EMPRESAS, JSON.stringify(estado.empresas));
    localStorage.setItem(CHAVE_SELECIONADA, estado.selecionadaId);
  } catch {
    // Ignora falha de escrita (modo privado, cota cheia): o estado em memória vale.
  }
  notificar();
}

export function subscribe(ouvinte: () => void) {
  ouvintes.add(ouvinte);

  // Mantém abas abertas do painel em sincronia.
  function aoMudarArmazenamento(evento: StorageEvent) {
    if (evento.key === CHAVE_EMPRESAS || evento.key === CHAVE_SELECIONADA) {
      cache = null;
      notificar();
    }
  }
  window.addEventListener("storage", aoMudarArmazenamento);

  return () => {
    ouvintes.delete(ouvinte);
    window.removeEventListener("storage", aoMudarArmazenamento);
  };
}

export function getSnapshot(): EstadoEmpresas {
  cache ??= ler();
  return cache;
}

export function getServerSnapshot(): EstadoEmpresas {
  return ESTADO_INICIAL;
}

export function selecionarEmpresa(id: string) {
  const estado = getSnapshot();
  if (estado.selecionadaId === id) return;
  escrever({ ...estado, selecionadaId: id });
}

export function cadastrarEmpresa(dados: Omit<Empresa, "id">): Empresa {
  const estado = getSnapshot();
  const empresa: Empresa = { ...dados, id: novaEmpresaId() };
  escrever({
    empresas: [...estado.empresas, empresa],
    selecionadaId: empresa.id,
  });
  return empresa;
}
