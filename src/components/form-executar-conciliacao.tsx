"use client";

import { useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { Field, Input, SwitchField } from "@/components/form";
import { IconCheck, IconUpload } from "@/components/icons";
import { TabelaResultadosConciliacao } from "@/components/tabela-resultados-conciliacao";
import {
  executarConciliacaoCompleta,
  executarConciliacaoSimples,
  type ResumoConciliacaoCompleta,
  type ResumoExtrato,
} from "@/lib/acoes-conciliacao";
import { formatarDataCurta } from "@/lib/tipos";

type EstadoSimples =
  | { tipo: "ocioso" }
  | { tipo: "enviando" }
  | { tipo: "erro"; msg: string }
  | { tipo: "ok"; resumo: ResumoExtrato };

type EstadoCompleto =
  | { tipo: "ocioso" }
  | { tipo: "enviando" }
  | { tipo: "erro"; msg: string }
  | { tipo: "ok"; resumo: ResumoConciliacaoCompleta };

const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FormExecutarConciliacao({ empresaId }: { empresaId: string }) {
  const [estado, setEstado] = useState<EstadoSimples>({ tipo: "ocioso" });
  const [estadoCompleto, setEstadoCompleto] = useState<EstadoCompleto>({ tipo: "ocioso" });
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [contaOmie, setContaOmie] = useState("");
  const [atualizarTitulos, setAtualizarTitulos] = useState(false);
  const arquivoRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function executar(arquivo: File) {
    arquivoRef.current = arquivo;
    setNomeArquivo(arquivo.name);
    setEstado({ tipo: "enviando" });
    setEstadoCompleto({ tipo: "ocioso" });

    const dados = new FormData();
    dados.set("empresaId", empresaId);
    dados.set("arquivo", arquivo);

    const resultado = await executarConciliacaoSimples(dados);
    setEstado(
      resultado.erro
        ? { tipo: "erro", msg: resultado.erro }
        : { tipo: "ok", resumo: resultado.resumo! },
    );
  }

  async function executarCompleta() {
    const arquivo = arquivoRef.current;
    if (!arquivo) return;
    setEstadoCompleto({ tipo: "enviando" });

    const dados = new FormData();
    dados.set("empresaId", empresaId);
    dados.set("arquivo", arquivo);
    dados.set("contaOmie", contaOmie.trim());
    dados.set("atualizarTitulos", String(atualizarTitulos));

    const resultado = await executarConciliacaoCompleta(dados);
    setEstadoCompleto(
      resultado.erro
        ? { tipo: "erro", msg: resultado.erro }
        : { tipo: "ok", resumo: resultado.resumo! },
    );
  }

  const ocupado = estado.tipo === "enviando";
  const ocupadoCompleto = estadoCompleto.tipo === "enviando";
  const podeRodarCompleta = estado.tipo === "ok" && !!estado.resumo.clienteSlug;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Enviar extrato</h2>
        <p className="text-xs text-fg-muted">
          Sobe um extrato bancário (.ofx) e confirma que foi lido corretamente
          — linhas, período e movimento. Passo inicial da Conciliação
          Bancária, antes de casar cada linha com os títulos do Omie.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".ofx"
        className="hidden"
        aria-label="Arquivo do extrato"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) void executar(arquivo);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
        >
          <IconUpload className="size-4" />
          {ocupado ? "Processando…" : "Escolher extrato (.ofx)"}
        </Button>
        {nomeArquivo ? (
          <span className="text-xs text-fg-subtle">{nomeArquivo}</span>
        ) : null}
      </div>

      {estado.tipo === "erro" ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {estado.msg}
        </p>
      ) : null}

      {estado.tipo === "ok" ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-4">
          <div className="flex items-center gap-2">
            <Badge tone="success">
              <IconCheck className="size-4" />
              Executado com sucesso
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-subtle">Linhas</dt>
              <dd className="font-medium tabular-nums">{estado.resumo.linhas}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">Período</dt>
              <dd className="font-medium tabular-nums">
                {formatarDataCurta(estado.resumo.periodoInicio)} –{" "}
                {formatarDataCurta(estado.resumo.periodoFim)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">Movimento líquido (R$)</dt>
              <dd className="font-medium tabular-nums">
                {numero.format(Number(estado.resumo.movimentoLiquido))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">Banco detectado</dt>
              <dd className="font-medium">{estado.resumo.bancoDetectado ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-subtle">Cliente Omie vinculado</dt>
              <dd className="font-medium">{estado.resumo.clienteNome ?? "—"}</dd>
            </div>
          </dl>
          {!estado.resumo.clienteSlug ? (
            <p className="text-xs text-fg-subtle">
              Esta empresa ainda não está vinculada a um cliente do
              proos-omie-mcp — o extrato foi lido, mas ainda não dá pra
              casar com os títulos do Omie. Configure o{" "}
              <code className="rounded bg-surface-muted px-1">empresa_id</code>{" "}
              dela em <code className="rounded bg-surface-muted px-1">clientes_omie.json</code>.
            </p>
          ) : null}
        </div>
      ) : null}

      {podeRodarCompleta ? (
        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <h3 className="text-sm font-semibold">Rodar conciliação completa</h3>
            <p className="text-xs text-fg-muted">
              Casa cada linha do extrato com os títulos do Omie — automático,
              revisão ou exceção. Só leitura: nada é gravado no Omie aqui.
            </p>
          </div>

          <Field
            label="Código da conta corrente no Omie (nCodCC)"
            hint="Opcional — se deixar em branco, o sistema tenta descobrir sozinho pelo número da conta no próprio extrato."
            layout="inline"
          >
            <Input
              value={contaOmie}
              onChange={(e) => setContaOmie(e.target.value)}
              placeholder="deixe em branco pra resolver automaticamente"
              disabled={ocupadoCompleto}
            />
          </Field>

          <SwitchField
            label="Atualizar títulos do Omie antes de rodar"
            hint="Busca ao vivo na Omie em vez do snapshot em disco — mais lento (pode levar minutos), mas com dados frescos."
            checked={atualizarTitulos}
            onChange={setAtualizarTitulos}
          />

          <Button
            variant="secondary"
            onClick={() => void executarCompleta()}
            disabled={ocupadoCompleto}
          >
            {ocupadoCompleto
              ? atualizarTitulos ? "Buscando títulos e rodando…" : "Rodando…"
              : "Rodar conciliação completa"}
          </Button>

          {estadoCompleto.tipo === "erro" ? (
            <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              {estadoCompleto.msg}
            </p>
          ) : null}

          {estadoCompleto.tipo === "ok" ? (
            <div className="space-y-3">
              <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">
                    {estadoCompleto.resumo.automatico} automático
                  </Badge>
                  <Badge tone="warning">{estadoCompleto.resumo.revisao} revisão</Badge>
                  <Badge tone="danger">{estadoCompleto.resumo.excecao} exceção</Badge>
                  <span className="text-xs text-fg-subtle">
                    de {estadoCompleto.resumo.total} linhas · títulos: {estadoCompleto.resumo.titulosArquivo}
                    {estadoCompleto.resumo.titulosAtualizados ? " (atualizados agora)" : " (snapshot em disco)"}
                  </span>
                  {estadoCompleto.resumo.regrasCarregadas > 0 ? (
                    <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                      {estadoCompleto.resumo.regrasCarregadas} regra(s) aprendida(s) aplicada(s)
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-fg-subtle">
                  Conta Omie: <span className="font-medium text-fg">{estadoCompleto.resumo.contaOmie}</span>
                  {estadoCompleto.resumo.contaOmieResolvidaAutomaticamente
                    ? " (resolvida automaticamente pelo extrato)"
                    : " (informada manualmente)"}
                </p>
                {Object.keys(estadoCompleto.resumo.porExcecao).length > 0 ? (
                  <div>
                    <p className="text-xs text-fg-subtle">Exceções por tipo</p>
                    <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                      {Object.entries(estadoCompleto.resumo.porExcecao).map(([tipo, qtd]) => (
                        <li key={tipo} className="flex justify-between gap-2">
                          <span className="text-fg-muted">{tipo}</span>
                          <span className="font-medium tabular-nums">{qtd}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <TabelaResultadosConciliacao
                linhas={estadoCompleto.resumo.linhas}
                contaOmie={estadoCompleto.resumo.contaOmie}
                titulosCarregados={estadoCompleto.resumo.titulosCarregados}
                empresaId={empresaId}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
