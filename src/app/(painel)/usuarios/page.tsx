import type { Metadata } from "next";
import { IconDots, IconPlus } from "@/components/icons";
import {
  Badge,
  Button,
  Dot,
  PageHeader,
  SearchInput,
  StatCard,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  formatarDataHora,
  iniciais,
  rotuloPapel,
  rotuloStatusUsuario,
} from "@/lib/tipos";
import { empresaAtual } from "@/lib/dal";
import { lerEmpresaSelecionada } from "@/lib/empresa-selecionada";
import { listarUsuarios } from "@/lib/consultas";
import { nivelDot, toneStatusUsuario } from "@/lib/status-cores";

export const metadata: Metadata = { title: "Usuários · Painel" };

export default async function UsuariosPage() {
  const empresa = await empresaAtual(await lerEmpresaSelecionada());
  const usuarios = empresa ? await listarUsuarios(empresa.id) : [];

  const ativos = usuarios.filter((u) => u.status === "ativo").length;
  const convidados = usuarios.filter((u) => u.status === "convidado").length;

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Pessoas com acesso ao painel e seus respectivos papéis."
        actions={
          <Button variant="primary">
            <IconPlus className="size-4" />
            Convidar usuário
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Usuários" value={String(usuarios.length)} hint="Total cadastrado" />
        <StatCard label="Ativos" value={String(ativos)} hint="Com acesso liberado" />
        <StatCard label="Convites pendentes" value={String(convidados)} hint="Aguardando aceite" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Buscar usuário" />
        <Button variant="secondary">Papel</Button>
        <Button variant="secondary">Status</Button>
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Usuário</Th>
            <Th>Papel</Th>
            <Th>Status</Th>
            <Th>Último acesso</Th>
            <Th className="w-12" />
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
              <Td>
                <Button variant="ghost" className="size-8 justify-center px-0" aria-label="Mais ações">
                  <IconDots className="size-4" />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
