"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { Modal } from "@/components/modal";
import { IconCheck } from "@/components/icons";
import { formatarDataCurta } from "@/lib/tipos";
import {
  decidirLinhaConciliacao,
  type ResultadoDecisaoLinha,
  type ResultadoLinha,
  type TituloResumo,
} from "@/lib/acoes-conciliacao";

const numero = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Modo = "resumo" | "busca" | "lancamento_direto" | "transferencia";

/**
 * Interação única que muda de conteúdo conforme a situação da linha, em vez
 * de uma tela por tipo de exceção — a taxonomia de ações por `tipoExcecao`
 * já existia em `fila_conciliacao.html` (protótipo), aqui ela vira de fato
 * uma decisão que é registrada (`decidirLinhaConciliacao`).
 */
export function ModalDecisaoLinha({
  linha,
  contaOmie,
  titulosCarregados,
  empresaId,
  onFechar,
  onDecidido,
}: {
  linha: ResultadoLinha;
  contaOmie: string;
  titulosCarregados: TituloResumo[];
  empresaId: string;
  onFechar: () => void;
  onDecidido: (linhaId: string, resultado: ResultadoDecisaoLinha) => void;
}) {
  const [modo, setModo] = useState<Modo>("resumo");
  const [categoria, setCategoria] = useState(linha.categoria ?? "");
  const [contaDestino, setContaDestino] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();

  const sugestaoMotor = {
    desfecho: linha.desfecho,
    faixa: linha.faixa,
    score: linha.score,
    tituloId: linha.tituloId,
    tipoExcecao: linha.tipoExcecao,
  };

  function decidir(decisao: Parameters<typeof decidirLinhaConciliacao>[1]["decisao"]) {
    setErro(null);
    iniciarEnvio(async () => {
      const resultado = await decidirLinhaConciliacao(empresaId, {
        linha: {
          linhaId: linha.linhaId,
          contaId: contaOmie,
          data: linha.data,
          valor: linha.valor,
          descricao: linha.descricao,
        },
        sugestaoMotor,
        decisao,
      });
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      onDecidido(linha.linhaId, resultado);
      onFechar();
    });
  }

  // "Confirmar duplicidade" não ensina nada nem precisa de auditoria extra
  // (a checagem de duplicidade já é exata — conta+data+valor contra o Omie,
  // não um padrão aprendido) — só um aceite local, sem chamar o script.
  function confirmarDuplicidadeLocal() {
    onDecidido(linha.linhaId, { aprendeu: false, regra: null });
    onFechar();
  }

  return (
    <Modal
      titulo="Decidir linha"
      descricao={`${formatarDataCurta(linha.data)} · ${numero.format(Number(linha.valor))} · ${linha.descricao}`}
      onFechar={onFechar}
      largura="xl"
    >
      <div className="space-y-4 px-5 py-4">
        {erro ? (
          <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{erro}</p>
        ) : null}

        {linha.tipoExcecao === "aguardando_retorno_boleto" ? (
          <ConteudoAguardandoBoleto onFechar={onFechar} />
        ) : linha.tipoExcecao === "duplicidade" && modo === "resumo" ? (
          <ConteudoDuplicidade
            enviando={enviando}
            onConfirmar={confirmarDuplicidadeLocal}
            onContestar={() => setModo("busca")}
          />
        ) : modo === "resumo" && linha.tituloId ? (
          <ConteudoCandidato
            linha={linha}
            enviando={enviando}
            onConfirmar={() => decidir({ desfecho: "titulo", tituloId: linha.tituloId })}
            onRejeitar={() => setModo("busca")}
          />
        ) : modo === "resumo" && linha.descartados.length > 0 ? (
          <ConteudoAmbiguidade
            descartados={linha.descartados}
            enviando={enviando}
            onEscolher={(tituloId) => decidir({ desfecho: "titulo", tituloId })}
            onNenhumDesses={() => setModo("busca")}
          />
        ) : modo === "lancamento_direto" ? (
          <ConteudoLancamentoDireto
            categoria={categoria}
            onCategoriaChange={setCategoria}
            enviando={enviando}
            onVoltar={() => setModo("busca")}
            onConfirmar={() => decidir({ desfecho: "lanc_direto", categoria: categoria.trim() || null })}
          />
        ) : modo === "transferencia" ? (
          <ConteudoTransferencia
            contaDestino={contaDestino}
            onContaDestinoChange={setContaDestino}
            enviando={enviando}
            onVoltar={() => setModo("busca")}
            onConfirmar={() => decidir({ desfecho: "transferencia", contaDestinoId: contaDestino.trim() || null })}
          />
        ) : (
          <ConteudoBusca
            titulos={titulosCarregados}
            enviando={enviando}
            onEscolherTitulo={(tituloId) => decidir({ desfecho: "titulo", tituloId })}
            onLancamentoDireto={() => setModo("lancamento_direto")}
            onTransferencia={() => setModo("transferencia")}
          />
        )}
      </div>
    </Modal>
  );
}

function ConteudoAguardandoBoleto({ onFechar }: { onFechar: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Recebimento consolidado de boleto — resolve sozinho quando o arquivo de
        retorno for importado no Omie. Não é uma decisão a tomar agora.
      </p>
      <div className="flex justify-end border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onFechar}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

function ConteudoDuplicidade({
  enviando,
  onConfirmar,
  onContestar,
}: {
  enviando: boolean;
  onConfirmar: () => void;
  onContestar: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Já existe um lançamento correspondente (mesma conta, data e valor) no
        Omie — provavelmente já foi conciliado por outro caminho.
      </p>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" disabled={enviando} onClick={onContestar}>
          Não é duplicidade
        </Button>
        <Button type="button" variant="primary" disabled={enviando} onClick={onConfirmar}>
          <IconCheck className="size-4" />
          Confirmar duplicidade
        </Button>
      </div>
    </div>
  );
}

function ConteudoCandidato({
  linha,
  enviando,
  onConfirmar,
  onRejeitar,
}: {
  linha: ResultadoLinha;
  enviando: boolean;
  onConfirmar: () => void;
  onRejeitar: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-4">
        <p className="text-xs text-fg-subtle">Candidato sugerido pelo motor</p>
        <p className="text-sm font-medium">{linha.tituloParceiro}</p>
        <p className="text-xs text-fg-muted">
          {linha.tituloValor ? numero.format(Number(linha.tituloValor)) : "—"}
          {linha.tituloVencimento ? ` · vence ${formatarDataCurta(linha.tituloVencimento)}` : ""}
          {linha.diferenca && linha.diferenca !== "0" ? ` · diferença ${numero.format(Number(linha.diferenca))}` : ""}
        </p>
        {linha.motivo ? <p className="text-xs text-fg-subtle">{linha.motivo}</p> : null}
      </Card>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" disabled={enviando} onClick={onRejeitar}>
          Rejeitar
        </Button>
        <Button type="button" variant="primary" disabled={enviando} onClick={onConfirmar}>
          <IconCheck className="size-4" />
          {enviando ? "Confirmando…" : "Confirmar"}
        </Button>
      </div>
    </div>
  );
}

function ConteudoAmbiguidade({
  descartados,
  enviando,
  onEscolher,
  onNenhumDesses,
}: {
  descartados: ResultadoLinha["descartados"];
  enviando: boolean;
  onEscolher: (tituloId: string) => void;
  onNenhumDesses: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Mais de um título parecido — escolha qual é o certo.
      </p>
      <div className="space-y-2">
        {descartados.map((c) => (
          <button
            key={c.tituloId}
            type="button"
            disabled={enviando}
            onClick={() => onEscolher(c.tituloId)}
            className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <span>
              {c.parceiro}
              <span className="text-fg-subtle"> · vence {formatarDataCurta(c.vencimento)}</span>
            </span>
            <span className="tabular-nums text-fg-muted">{numero.format(Number(c.valor))}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button type="button" variant="ghost" disabled={enviando} onClick={onNenhumDesses}>
          Nenhum desses — buscar outro título
        </Button>
      </div>
    </div>
  );
}

function ConteudoLancamentoDireto({
  categoria,
  onCategoriaChange,
  enviando,
  onVoltar,
  onConfirmar,
}: {
  categoria: string;
  onCategoriaChange: (v: string) => void;
  enviando: boolean;
  onVoltar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Categoria" hint="Código da categoria no Omie (ex.: tarifa, juros, rendimento).">
        <Input
          value={categoria}
          onChange={(e) => onCategoriaChange(e.target.value)}
          placeholder="código da categoria"
        />
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" disabled={enviando} onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="button" variant="primary" disabled={enviando || !categoria.trim()} onClick={onConfirmar}>
          {enviando ? "Confirmando…" : "Confirmar lançamento direto"}
        </Button>
      </div>
    </div>
  );
}

function ConteudoTransferencia({
  contaDestino,
  onContaDestinoChange,
  enviando,
  onVoltar,
  onConfirmar,
}: {
  contaDestino: string;
  onContaDestinoChange: (v: string) => void;
  enviando: boolean;
  onVoltar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Conta de destino (nCodCC)" hint="Código da conta corrente de destino no Omie.">
        <Input
          value={contaDestino}
          onChange={(e) => onContaDestinoChange(e.target.value)}
          placeholder="nCodCC da outra conta"
        />
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" disabled={enviando} onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="button" variant="primary" disabled={enviando || !contaDestino.trim()} onClick={onConfirmar}>
          {enviando ? "Confirmando…" : "Confirmar transferência"}
        </Button>
      </div>
    </div>
  );
}

function ConteudoBusca({
  titulos,
  enviando,
  onEscolherTitulo,
  onLancamentoDireto,
  onTransferencia,
}: {
  titulos: TituloResumo[];
  enviando: boolean;
  onEscolherTitulo: (tituloId: string) => void;
  onLancamentoDireto: () => void;
  onTransferencia: () => void;
}) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return titulos.slice(0, 30);
    return titulos
      .filter((t) =>
        t.parceiroNome.toLowerCase().includes(termo) ||
        (t.numeroDocumento ?? "").toLowerCase().includes(termo) ||
        t.valor.includes(termo),
      )
      .slice(0, 30);
  }, [busca, titulos]);

  return (
    <div className="space-y-4">
      <Field label="Buscar título" hint="Por nome do parceiro, número do documento ou valor.">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="ex.: Pedro Grossi, 12345, 500.00"
          autoFocus
        />
      </Field>

      <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-border p-1">
        {filtrados.length === 0 ? (
          <p className="p-3 text-center text-sm text-fg-subtle">Nenhum título encontrado.</p>
        ) : (
          filtrados.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={enviando}
              onClick={() => onEscolherTitulo(t.id)}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <span>
                {t.parceiroNome}
                <Badge tone="neutral" className="ml-2 px-1.5 py-0 text-[10px]">{t.tipo}</Badge>
                <span className="text-fg-subtle"> · vence {formatarDataCurta(t.vencimento)}</span>
              </span>
              <span className="tabular-nums text-fg-muted">{numero.format(Number(t.valor))}</span>
            </button>
          ))
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" disabled={enviando} onClick={onLancamentoDireto}>
          É lançamento direto
        </Button>
        <Button type="button" variant="ghost" disabled={enviando} onClick={onTransferencia}>
          É transferência
        </Button>
      </div>
    </div>
  );
}
