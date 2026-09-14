"use client";

import { useState, useTransition } from "react";
import { atualizarAutomacoesDoN8n, vincularAutomacao } from "@/lib/acoes";
import type { Vinculo } from "@/lib/consultas";
import { clsx } from "@/lib/clsx";
import { rotuloStatus } from "@/lib/tipos";
import { nivelDot, toneStatusAutomacao } from "@/lib/status-cores";
import { Select } from "@/components/form";
import { Badge, Button, Dot, EmptyHint, Table, Td, Th } from "@/components/ui";
import { LogoN8n } from "@/components/logos-servicos";

/**
 * Dispara a descoberta na hora. O cron já faz isso a cada cinco minutos —
 * este botão existe para quem acabou de criar o workflow no n8n e quer
 * vinculá-lo agora.
 */
export function BotaoAtualizarN8n() {
  const [pendente, iniciarTransicao] = useTransition();
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        disabled={pendente}
        onClick={() => {
          setMensagem(null);
          iniciarTransicao(async () => {
            const resultado = await atualizarAutomacoesDoN8n();
            setMensagem(
              resultado.erro
                ? { texto: resultado.erro, erro: true }
                : { texto: resultado.aviso ?? "Atualizado.", erro: false },
            );
          });
        }}
      >
        {pendente ? "Buscando…" : "Atualizar do n8n"}
      </Button>
      {mensagem ? (
        <p
          role="status"
          className={clsx(
            "max-w-xs text-right text-xs",
            mensagem.erro ? "text-danger" : "text-fg-muted",
          )}
        >
          {mensagem.texto}
        </p>
      ) : null}
    </div>
  );
}

type EmpresaOpcao = { id: string; nome: string; ehPlataforma: boolean };

export function VinculosAutomacoes({
  vinculos,
  empresas,
}: {
  vinculos: Vinculo[];
  empresas: EmpresaOpcao[];
}) {
  const [pendente, iniciarTransicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  if (vinculos.length === 0) {
    return (
      <EmptyHint>
        Nenhum workflow veio do n8n ainda. A sincronização roda a cada cinco
        minutos e traz sozinha o que existir na instância conectada — não é
        preciso cadastrar nada aqui.
      </EmptyHint>
    );
  }

  const opcoes = empresas.map((empresa) => ({
    valor: empresa.id,
    rotulo: empresa.ehPlataforma ? `${empresa.nome} (principal)` : empresa.nome,
  }));

  return (
    <>
      {erro ? (
        <p role="alert" className="text-sm text-danger">
          {erro}
        </p>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>Automação</Th>
            <Th>Status no n8n</Th>
            <Th className="w-64">Empresa</Th>
          </tr>
        </thead>
        <tbody>
          {vinculos.map((vinculo) => (
            <tr key={vinculo.id} className="hover:bg-surface-muted/50">
              <Td>
                {/* A logo marca a origem: toda linha desta tela veio do n8n,
                    nenhuma foi cadastrada no painel. */}
                <p className="flex items-center gap-2 font-medium">
                  <LogoN8n className="size-4 shrink-0" />
                  {vinculo.nome}
                </p>
              </Td>
              <Td>
                <Badge tone={toneStatusAutomacao[vinculo.status]}>
                  <Dot level={nivelDot(toneStatusAutomacao[vinculo.status])} />
                  {rotuloStatus[vinculo.status]}
                </Badge>
              </Td>
              <Td>
                <Select
                  aria-label={`Empresa de ${vinculo.nome}`}
                  value={vinculo.empresaId}
                  disabled={pendente}
                  onChange={(e) => {
                    const empresaId = e.target.value;
                    setErro(null);
                    iniciarTransicao(async () => {
                      const resultado = await vincularAutomacao({
                        automacaoId: vinculo.id,
                        empresaId,
                      });
                      if (resultado.erro) setErro(resultado.erro);
                    });
                  }}
                  options={opcoes}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
