"use server";

import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";

export type EstadoAtualizarSenha = { erro?: string };

export async function atualizarSenha(
  _estado: EstadoAtualizarSenha,
  dados: FormData,
): Promise<EstadoAtualizarSenha> {
  const senha = String(dados.get("senha") ?? "");
  const confirmacao = String(dados.get("confirmacao") ?? "");

  if (senha.length < 8) {
    return { erro: "A senha precisa ter pelo menos 8 caracteres." };
  }
  if (senha !== confirmacao) {
    return { erro: "As senhas não coincidem." };
  }

  const supabase = await criarClienteServidor();

  // Só chega aqui com sessão válida: o proxy exige login, e quem tem sessão
  // neste ponto veio do link de redefinição em `/auth/callback`.
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) {
    return { erro: "Não foi possível atualizar a senha. Tente pedir um novo link." };
  }

  redirect("/dashboard");
}
