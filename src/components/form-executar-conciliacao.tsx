"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { IconUpload } from "@/components/icons";
import { TabelaResultadosConciliacao } from "@/components/tabela-resultados-conciliacao";
import {
  confirmarGravacaoConciliacao,
  consultarConciliacao,
  enfileirarConciliacao,
  type ResumoConciliacaoCompleta,
  type StatusGravacao,
} from "@/lib/acoes-conciliacao";

type Fase = "ocioso" | "enfileirando" | "processando" | "ok" | "erro";

const ROTULO_ETAPA: Record<string, string> = {
  iniciando: "Iniciando…",
  conta: "Resolvendo a conta…",
  titulos: "Buscando títulos no Omie…",
  recebimentos: "Buscando recebimentos no Omie…",
  duplicidade: "Conferindo o que já existe no Omie…",
  motor: "Casando linha a linha…",
};

export function FormExecutarConciliacao({ empresaId }: { empresaId: string }) {
  const [fase, setFase] = useState<Fase>("ocioso");
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [contaOmie, setContaOmie] = useState("");
  const [execucaoId, setExecucaoId] = useState<number | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoConciliacaoCompleta | null>(null);
  // fase 2: gravacao (escrita no Omie da faixa automatica)
  const [gravFase, setGravFase] =
    useState<"ocioso" | "enviando" | "processando" | "ok" | "erro">("ocioso");
  const [gravResultado, setGravResultado] = useState<StatusGravacao | null>(null);
  const [gravErro, setGravErro] = useState<string | null>(null);
  const arquivoRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gravTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling: enquanto houver um pedido em andamento, pergunta o status a cada
  // 3s ate virar sucesso ou erro (o motor roda no container, pode levar
  // minutos por causa da busca ao vivo no Omie).
  useEffect(() => {
    if (execucaoId == null) return;
    let vivo = true;
    const parar = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const tick = async () => {
      const r = await consultarConciliacao(empresaId, execucaoId);
      if (!vivo) return;
      if (r.status === "sucesso" && r.resumo) {
        setResumo(r.resumo);
        setFase("ok");
        // Se já houve gravação para este pedido, reflete o estado dela.
        if (r.gravacao) {
          setGravResultado(r.gravacao);
          setGravFase(
            r.gravacao.status === "sucesso"
              ? "ok"
              : r.gravacao.status === "erro"
                ? "erro"
                : "processando",
          );
          if (r.gravacao.status === "erro") setGravErro(r.gravacao.erro ?? "Falha na gravação.");
        }
        parar();
      } else if (r.status === "erro") {
        setErro(r.erro ?? "Falha na conciliação.");
        setFase("erro");
        parar();
      } else {
        setEtapa(r.etapa ?? null);
      }
    };
    void tick();
    timerRef.current = setInterval(() => void tick(), 3000);
    return () => {
      vivo = false;
      parar();
    };
  }, [execucaoId, empresaId]);

  async function rodar() {
    const arquivo = arquivoRef.current;
    if (!arquivo) return;
    setFase("enfileirando");
    setErro(null);
    setResumo(null);
    setEtapa(null);
    setGravFase("ocioso");
    setGravResultado(null);
    setGravErro(null);

    const dados = new FormData();
    dados.set("empresaId", empresaId);
    dados.set("arquivo", arquivo);
    dados.set("contaOmie", contaOmie.trim());

    const r = await enfileirarConciliacao(dados);
    if (r.erro || !r.execucaoId) {
      setErro(r.erro ?? "Não foi possível enfileirar a conciliação.");
      setFase("erro");
      return;
    }
    setExecucaoId(r.execucaoId);
    setFase("processando");
  }

  // Polling da gravacao: enquanto o worker executa as baixas, pergunta o
  // estado a cada 3s ate sucesso ou erro.
  useEffect(() => {
    if (gravFase !== "processando" || execucaoId == null) return;
    let vivo = true;
    const parar = () => {
      if (gravTimerRef.current) {
        clearInterval(gravTimerRef.current);
        gravTimerRef.current = null;
      }
    };
    const tick = async () => {
      const r = await consultarConciliacao(empresaId, execucaoId);
      if (!vivo) return;
      const g = r.gravacao;
      if (!g) return;
      setGravResultado(g);
      if (g.status === "sucesso") {
        setGravFase("ok");
        parar();
      } else if (g.status === "erro") {
        setGravErro(g.erro ?? "Falha na gravação.");
        setGravFase("erro");
        parar();
      }
    };
    void tick();
    gravTimerRef.current = setInterval(() => void tick(), 3000);
    return () => {
      vivo = false;
      parar();
    };
  }, [gravFase, execucaoId, empresaId]);

  async function confirmarGravacao() {
    if (execucaoId == null || !resumo) return;
    const ok = window.confirm(
      `Gravar ${resumo.automatico} lançamento(s) da faixa automática no Omie?\n\n` +
        "Só a faixa automática é gravada; revisão e exceção continuam na fila. " +
        "É reversível (desconciliar no Omie).",
    );
    if (!ok) return;
    setGravErro(null);
    setGravFase("enviando");
    const r = await confirmarGravacaoConciliacao(empresaId, execucaoId);
    if (r.erro) {
      setGravErro(r.erro);
      setGravFase("erro");
      return;
    }
    setGravFase("processando");
  }

  const ocupado = fase === "enfileirando" || fase === "processando";

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Enviar extrato</h2>
        <p className="text-xs text-fg-muted">
          Sobe um extrato bancário (.ofx) e casa cada linha com os títulos do
          Omie — automático, revisão ou exceção. Roda no servidor e busca os
          títulos e recebimentos ao vivo no Omie. Só leitura: nada é gravado.
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
          if (arquivo) {
            arquivoRef.current = arquivo;
            setNomeArquivo(arquivo.name);
            setFase("ocioso");
            setResumo(null);
            setErro(null);
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
        >
          <IconUpload className="size-4" />
          {nomeArquivo ? "Trocar extrato (.ofx)" : "Escolher extrato (.ofx)"}
        </Button>
        {nomeArquivo ? (
          <span className="text-xs text-fg-subtle">{nomeArquivo}</span>
        ) : null}
      </div>

      {nomeArquivo ? (
        <div className="space-y-3 border-t border-border pt-4">
          <Field
            label="Código da conta corrente no Omie (nCodCC)"
            hint="Opcional — em branco, o sistema resolve sozinho pelo número da conta no próprio extrato."
            layout="inline"
          >
            <Input
              value={contaOmie}
              onChange={(e) => setContaOmie(e.target.value)}
              placeholder="deixe em branco pra resolver automaticamente"
              disabled={ocupado}
            />
          </Field>

          <Button variant="secondary" onClick={() => void rodar()} disabled={ocupado}>
            {fase === "enfileirando"
              ? "Enviando…"
              : fase === "processando"
                ? ROTULO_ETAPA[etapa ?? ""] ?? "Processando…"
                : "Rodar conciliação"}
          </Button>
        </div>
      ) : null}

      {fase === "erro" && erro ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{erro}</p>
      ) : null}

      {fase === "ok" && resumo ? (
        <div className="space-y-3">
          <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{resumo.automatico} automático</Badge>
              <Badge tone="warning">{resumo.revisao} revisão</Badge>
              {/* Duplicidade (ja conciliado no Omie) nao e exceção a tratar:
                  sai da contagem de exceção e vira um selo neutro proprio. */}
              <Badge tone="danger">
                {resumo.excecao - (resumo.porExcecao.duplicidade ?? 0)} exceção
              </Badge>
              {(resumo.porExcecao.duplicidade ?? 0) > 0 ? (
                <Badge tone="neutral">{resumo.porExcecao.duplicidade} já no Omie</Badge>
              ) : null}
              <span className="text-xs text-fg-subtle">de {resumo.total} linhas</span>
              {resumo.regrasCarregadas > 0 ? (
                <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                  {resumo.regrasCarregadas} regra(s) aplicada(s)
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-fg-subtle">
              Conta Omie: <span className="font-medium text-fg">{resumo.contaOmie}</span>
              {resumo.contaOmieResolvidaAutomaticamente
                ? " (resolvida automaticamente pelo extrato)"
                : " (informada manualmente)"}
            </p>
            {Object.entries(resumo.porExcecao).filter(([tipo]) => tipo !== "duplicidade")
              .length > 0 ? (
              <div>
                <p className="text-xs text-fg-subtle">Exceções por tipo</p>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  {Object.entries(resumo.porExcecao)
                    .filter(([tipo]) => tipo !== "duplicidade")
                    .map(([tipo, qtd]) => (
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
            linhas={resumo.linhas}
            contaOmie={resumo.contaOmie}
            titulosCarregados={resumo.titulosCarregados}
            empresaId={empresaId}
          />

          {/* Fase 2: gravar a faixa automática no Omie (só leitura até aqui). */}
          <div className="space-y-2 rounded-md border border-border p-4">
            {gravFase === "ok" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="success">Gravado no Omie</Badge>
                <span className="text-xs text-fg-subtle">
                  {gravResultado?.executadas ?? 0} baixa(s) gravada(s)
                  {gravResultado?.puladas ? ` · ${gravResultado.puladas} pulada(s)` : ""}
                  {gravResultado?.falhas ? ` · ${gravResultado.falhas} falha(s)` : ""} — reversível
                  (desconciliar no Omie se precisar).
                </span>
              </div>
            ) : resumo.automatico > 0 ? (
              <>
                <p className="text-sm">
                  Gravar a <b>faixa automática</b> ({resumo.automatico} lançamento
                  {resumo.automatico === 1 ? "" : "s"}) no Omie. Revisão e exceção continuam na fila.
                </p>
                <Button
                  variant="primary"
                  onClick={() => void confirmarGravacao()}
                  disabled={gravFase === "enviando" || gravFase === "processando"}
                >
                  {gravFase === "enviando"
                    ? "Enviando…"
                    : gravFase === "processando"
                      ? "Gravando no Omie…"
                      : `Confirmar e gravar (${resumo.automatico})`}
                </Button>
                {gravFase === "erro" && gravErro ? (
                  <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{gravErro}</p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-fg-subtle">Nada na faixa automática para gravar.</p>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
