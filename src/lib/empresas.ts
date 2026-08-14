/**
 * Empresas do painel. Placeholder — substituir por chamadas reais quando a API existir.
 */

export type Empresa = {
  id: string;
  nome: string;
  cnpj?: string;
  email?: string;
};

export const empresasIniciais: Empresa[] = [
  {
    id: "emp-001",
    nome: "Empresa Placeholder 01",
    cnpj: "00.000.000/0001-00",
    email: "contato01@exemplo.com",
  },
  {
    id: "emp-002",
    nome: "Empresa Placeholder 02",
    cnpj: "00.000.000/0002-00",
    email: "contato02@exemplo.com",
  },
];

export function novaEmpresaId() {
  return `emp-${Math.random().toString(36).slice(2, 9)}`;
}

/** "00000000000100" -> "00.000.000/0001-00" (formata parcialmente enquanto digita) */
export function formatarCnpj(valor: string) {
  const d = valor.replace(/\D/g, "").slice(0, 14);
  let saida = d.slice(0, 2);
  if (d.length > 2) saida += `.${d.slice(2, 5)}`;
  if (d.length > 5) saida += `.${d.slice(5, 8)}`;
  if (d.length > 8) saida += `/${d.slice(8, 12)}`;
  if (d.length > 12) saida += `-${d.slice(12, 14)}`;
  return saida;
}
