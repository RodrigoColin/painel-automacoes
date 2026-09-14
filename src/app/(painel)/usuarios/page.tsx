import type { Metadata } from "next";
import {
  Badge,
  Dot,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { BotaoConvidarUsuario } from "@/components/form-convidar-usuario";
import { AcoesUsuario } from "@/components/acoes-usuario";
import {
  formatarDataHora,
  iniciais,
  rotuloPapel,
  rotuloStatusUsuario,
} from "@/lib/tipos";
import { empresaAtual, empresasDoUsuario, verificarSessao } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarUsuarios } from "@/lib/consultas";
import { nivelDot, toneStatusUsuario } from "@/lib/status-cores";

export const metadata: Metadata = { title: "Usuários · Painel" };

export default async function UsuariosPage() {
  const { userId } = await verificarSessao();
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const usuarios = empresa ? await listarUsuarios(empresa.id) : [];

  // Só quem administra esta empresa convida, edita e exclui gente — mesma
  // regra que as actions já reforçam no servidor; aqui só decide se os
  // controles aparecem.
  const souAdminDaEmpresa = empresa
    ? (await empresasDoUsuario()).some((e) => e.id === empresa.id && e.papel === "admin")
    : false;

  const ativos = usuarios.filter((u) => u.status === "ativo").length;
  const convidados = usuarios.filter((u) => u.status === "convidado").length;

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Pessoas com acesso ao painel e seus respectivos papéis."
        actions={
          empresa && souAdminDaEmpresa ? (
            <BotaoConvidarUsuario empresaId={empresa.id} />
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Usuários" value={String(usuarios.length)} hint="Total cadastrado" />
        <StatCard label="Ativos" value={String(ativos)} hint="Com acesso liberado" />
        <StatCard label="Convites pendentes" value={String(convidados)} hint="Aguardando aceite" />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Usuário</Th>
            <Th>Papel</Th>
            <Th>Status</Th>
            <Th>Último acesso</Th>
            {souAdminDaEmpresa ? <Th className="w-28 text-right">Ações</Th> : null}
          </tr>
        </thead>
        <tbody>
          {usuarios.map((usuario) => (
            <tr key={usuario.id} className="hover:bg-surface-muted/50">
              <Td>
                <div className="flex items-center gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-medium text-fg-muted">
                    {iniciais(usuario.nome)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{usuario.nome}</p>
                    <p className="truncate text-xs text-fg-subtle">{usuario.email}</p>
                  </div>
                </div>
              </Td>
              <Td className="text-fg-muted">{rotuloPapel[usuario.papel]}</Td>
              <Td>
                <Badge tone={toneStatusUsuario[usuario.status]}>
                  <Dot level={nivelDot(toneStatusUsuario[usuario.status])} />
                  {rotuloStatusUsuario[usuario.status]}
                </Badge>
              </Td>
              <Td className="text-fg-muted tabular-nums">
                {formatarDataHora(usuario.ultimoAcesso)}
              </Td>
              {souAdminDaEmpresa && empresa ? (
                <Td>
                  <AcoesUsuario
                    empresaId={empresa.id}
                    usuario={usuario}
                    souEu={usuario.id === userId}
                  />
                </Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
