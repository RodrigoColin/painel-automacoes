"use client";

import { useState } from "react";
import { Field, Input, SwitchField } from "@/components/form";
import { Button } from "@/components/ui";
import { salvarConfigPlanos } from "@/lib/planos-acao/acoes";
import type { ConfigPlanos } from "@/lib/planos-acao/tipos";

/**
 * Quando um cliente inadimplente vira card nos planos de ação: liga/desliga
 * e os dois limites. Os limites só decidem a criação — card que já existe
 * continua no quadro mesmo que o cliente fique abaixo deles.
 */
export function FormConfigPlanos({ empresaId, config }: { empresaId: string; config: ConfigPlanos }) {
  const [auto, setAuto] = useState(config.autoInadimplencia);
  const [dias, setDias] = useState(String(config.atrasoMinimoDias));
  const [valor, setValor] = useState(String(config.valorMinimo));
  const [estado, setEstado] = useState<
    { tipo: "ocioso" } | { tipo: "salvando" } | { tipo: "erro"; msg: string } | { tipo: "ok" }
  >({ tipo: "ocioso" });

  const mudou =
    auto !== config.autoInadimplencia ||
    Number(dias) !== config.atrasoMinimoDias ||
    Number(valor) !== config.valorMinimo;

  async function salvar() {
    setEstado({ tipo: "salvando" });
    const resultado = await salvarConfigPlanos({
      empresaId,
      autoInadimplencia: auto,
      atrasoMinimoDias: Number(dias),
      valorMinimo: Number(valor),
    });
    setEstado(resultado.erro ? { tipo: "erro", msg: resultado.erro } : { tipo: "ok" });
  }

  const editar = <T,>(aplicar: (valor: T) => void) => (novo: T) => {
    aplicar(novo);
    setEstado({ tipo: "ocioso" });
  };

  return (
    <div className="space-y-4">
      <SwitchField
        label="Criar card para clientes inadimplentes"
        hint="A cada atualização do fluxo de caixa, quem passar dos limites abaixo entra em “A tratar”. Quem quitar vai para “Concluído” sozinho."
        checked={auto}
        onChange={editar(setAuto)}
      />

      <Field layout="inline" label="Atraso mínimo (dias)" hint="Maior atraso do cliente entre os títulos vencidos no ano.">
        <Input
          type="number"
          min={0}
          step={1}
          value={dias}
          disabled={!auto}
          onChange={(e) => editar(setDias)(e.target.value)}
        />
      </Field>

      <Field layout="inline" label="Valor mínimo vencido (R$)" hint="Soma vencida em aberto do cliente no ano. Zero = qualquer valor.">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={valor}
          disabled={!auto}
          onChange={(e) => editar(setValor)(e.target.value)}
        />
      </Field>

      <div className="flex items-center justify-end gap-3">
        {estado.tipo === "erro" ? (
          <span role="alert" className="text-xs text-danger">
            {estado.msg}
          </span>
        ) : estado.tipo === "ok" ? (
          <span className="text-xs text-fg-muted">Salvo. Vale a partir da próxima atualização do quadro.</span>
        ) : null}
        <Button variant="secondary" onClick={salvar} disabled={estado.tipo === "salvando" || !mudou}>
          {estado.tipo === "salvando" ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
