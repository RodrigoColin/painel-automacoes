/**
 * Telas que a Proos pode liberar ou esconder por empresa cliente.
 *
 * "Usuários" e "Configurações" ficam de fora de propósito: são por onde a
 * própria Proos administra o acesso, e desligá-las poderia trancar todo mundo
 * para fora. Sem registro no banco, a tela está liberada.
 */

export const TELAS = [
  { chave: "dashboard", href: "/dashboard", rotulo: "Dashboard" },
  { chave: "omie", href: "/omie", rotulo: "Gestão de Receitas" },
  { chave: "fluxo-caixa", href: "/fluxo-caixa", rotulo: "Fluxo de caixa" },
  { chave: "inadimplencia", href: "/inadimplencia", rotulo: "Inadimplência" },
  { chave: "validacao-saldo", href: "/validacao-saldo", rotulo: "Validação de saldo" },
  { chave: "conciliacao-bancaria", href: "/conciliacao-bancaria", rotulo: "Enviar extrato" },
  { chave: "automacoes", href: "/automacoes", rotulo: "Automações" },
  { chave: "historico", href: "/historico", rotulo: "Histórico" },
  { chave: "acessos", href: "/acessos", rotulo: "Acessos e chaves" },
] as const;

export type ChaveTela = (typeof TELAS)[number]["chave"];
export type NivelTela = "interno" | "externo";

/** Estado de cada tela para uma empresa: `true` = liberada. */
export type ConfigTelas = Record<string, { interno: boolean; externo: boolean }>;

export function chaveDaRota(href: string): ChaveTela | undefined {
  return TELAS.find((tela) => href === tela.href || href.startsWith(`${tela.href}/`))?.chave;
}
