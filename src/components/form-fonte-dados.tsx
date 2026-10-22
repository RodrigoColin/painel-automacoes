"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { Field, Input, Select } from "@/components/form";
import { atualizarProvedorEmpresa, excluirTokenNibo, salvarTokenNibo } from "@/lib/acoes";

type Estado =
  | { tipo: "ocioso" }
  | { tipo: "salvando" }
  | { tipo: "erro"; msg: string }
  | { tipo: "ok"; msg?: string };

/**
 * ERP que alimenta o fluxo de caixa da empresa (Omie ou Nibo) e, para Nibo, o
 * token da API — a tela por onde um cliente Nibo é ligado sem tocar no banco.
 * Só aparece para admin da Proos, numa empresa cliente (ver configuracoes/page).
 */
export function FormFonteDados({
  empresaId,
  provedorAtual,
  temTokenNibo,
}: {
  empresaId: string;
  provedorAtual: "omie" | "nibo";
  temTokenNibo: boolean;
}) {
  const [provedor, setProvedor] = useState<"omie" | "nibo">(provedorAtual);
  const [estadoProv, setEstadoProv] = useState<Estado>({ tipo: "ocioso" });
  const [token, setToken] = useState("");
  const [estadoTok, setEstadoTok] = useState<Estado>({ tipo: "ocioso" });
  const [tokenGravado, setTokenGravado] = useState(temTokenNibo);

  async function trocarProvedor(novo: "omie" | "nibo") {
    setProvedor(novo);
    setEstadoProv({ tipo: "salvando" });
    const resultado = await atualizarProvedorEmpresa({ empresaId, provedor: novo });
    setEstadoProv(resultado.erro ? { tipo: "erro", msg: resultado.erro } : { tipo: "ok" });
  }

  async function salvarToken() {
    setEstadoTok({ tipo: "salvando" });
    const resultado = await salvarTokenNibo({ empresaId, token });
    if (resultado.erro) {
      setEstadoTok({ tipo: "erro", msg: resultado.erro });
      return;
    }
    setToken("");
    setTokenGravado(true);
    setEstadoTok({ tipo: "ok", msg: "Token salvo e validado no Nibo." });
  }

  async function removerToken() {
    setEstadoTok({ tipo: "salvando" });
    const resultado = await excluirTokenNibo(empresaId);
    if (resultado.erro) {
      setEstadoTok({ tipo: "erro", msg: resultado.erro });
      return;
    }
    setTokenGravado(false);
    setEstadoTok({ tipo: "ok", msg: "Token removido." });
  }

  return (
    <>
      <Field
        layout="inline"
        label="ERP (fonte do fluxo de caixa)"
        hint={
          estadoProv.tipo === "erro"
            ? estadoProv.msg
            : estadoProv.tipo === "salvando"
              ? "Salvando…"
              : estadoProv.tipo === "ok"
                ? "Salvo."
                : "Qual sistema alimenta o painel de caixa desta empresa."
        }
      >
        <Select
          value={provedor}
          onChange={(e) => trocarProvedor(e.target.value as "omie" | "nibo")}
          disabled={estadoProv.tipo === "salvando"}
          options={[
            { valor: "omie", rotulo: "Omie" },
            { valor: "nibo", rotulo: "Nibo" },
          ]}
        />
      </Field>

      {provedor === "nibo" ? (
        <Field
          layout="inline"
          label="Token da API Nibo"
          hint={
            estadoTok.tipo === "erro"
              ? estadoTok.msg
              : estadoTok.tipo === "salvando"
                ? "Validando no Nibo…"
                : estadoTok.tipo === "ok"
                  ? estadoTok.msg ?? "Salvo."
                  : tokenGravado
                    ? "Um token já está salvo. Cole um novo para renovar — sem API Pública ele expira em poucos dias."
                    : "Cole o token gerado em Configurações > API da empresa, dentro do Nibo."
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={token}
              placeholder={tokenGravado ? "•••••••• (um token já está salvo)" : "Cole o token"}
              onChange={(e) => {
                setToken(e.target.value);
                setEstadoTok({ tipo: "ocioso" });
              }}
              className="min-w-0 flex-1"
            />
            <Button
              variant="secondary"
              onClick={salvarToken}
              disabled={estadoTok.tipo === "salvando" || !token.trim()}
              className="shrink-0"
            >
              {estadoTok.tipo === "salvando" ? "Salvando…" : "Salvar"}
            </Button>
            {tokenGravado ? (
              <Button
                variant="secondary"
                onClick={removerToken}
                disabled={estadoTok.tipo === "salvando"}
                className="shrink-0"
              >
                Excluir
              </Button>
            ) : null}
          </div>
        </Field>
      ) : null}
    </>
  );
}
