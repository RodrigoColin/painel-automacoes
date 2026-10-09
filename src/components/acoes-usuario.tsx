"use client";

import { useState } from "react";
import { IconEditar, IconLixeira } from "@/components/icons";
import { Button, classesBotao, classesBotaoLixeira } from "@/components/ui";
import { Field, Input } from "@/components/form";
import { Modal } from "@/components/modal";
import { Toggle } from "@/components/toggle";
import { atualizarUsuario, excluirUsuario } from "@/lib/acoes";
import { TELAS } from "@/lib/telas";
import type { Usuario } from "@/lib/tipos";

/** Espelha `SENHA_MINIMA` no servidor — aqui só para avisar antes de enviar. */
const SENHA_MINIMA = 8;

/**
 * Editar e excluir um usuário da empresa, na própria linha da tabela.
 *
 * Só aparece para quem administra a empresa; a permissão de verdade está nas
 * actions, que conferem o papel de quem chamou e o vínculo do alvo.
 */
export function AcoesUsuario({
  empresaId,
  usuario,
  souEu,
  telasOcultas,
  telasConfiguraveis,
}: {
  empresaId: string;
  usuario: Usuario;
  /** A própria linha de quem está olhando — não se exclui. */
  souEu: boolean;
  /** Telas hoje desligadas para esta pessoa, nesta empresa. */
  telasOcultas: string[];
  /** Falso para admin da plataforma, que enxerga todas as telas sempre. */
  telasConfiguraveis: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditando(true)}
        aria-label={`Editar ${usuario.nome}`}
        title="Editar"
        className={classesBotao("ghost", "size-9 justify-center px-0")}
      >
        <IconEditar className="size-5" />
      </button>

      <button
        type="button"
        onClick={() => setExcluindo(true)}
        disabled={souEu}
        aria-label={`Excluir ${usuario.nome}`}
        title={souEu ? "Você não pode excluir o próprio acesso" : "Excluir"}
        className={classesBotaoLixeira}
      >
        <IconLixeira className="size-5" />
      </button>

      {editando ? (
        <ModalEditar
          empresaId={empresaId}
          usuario={usuario}
          telasOcultas={telasOcultas}
          telasConfiguraveis={telasConfiguraveis}
          onFechar={() => setEditando(false)}
        />
      ) : null}

      {excluindo ? (
        <ModalExcluir
          empresaId={empresaId}
          usuario={usuario}
          onFechar={() => setExcluindo(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Nome, senha e as telas que a pessoa enxerga nesta empresa. O e-mail não
 * entra: ele é a identidade da conta no Auth, e trocá-lo é mudar o login da
 * pessoa, não editar um cadastro.
 *
 * Os interruptores só valem ao salvar, junto com o resto do formulário.
 */
function ModalEditar({
  empresaId,
  usuario,
  telasOcultas,
  telasConfiguraveis,
  onFechar,
}: {
  empresaId: string;
  usuario: Usuario;
  telasOcultas: string[];
  telasConfiguraveis: boolean;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [senha, setSenha] = useState("");
  const [ocultas, setOcultas] = useState(telasOcultas);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();

    if (!nome.trim()) {
      setErro("Informe o nome da pessoa.");
      return;
    }
    // Senha em branco quer dizer "não mexer", não "senha vazia".
    if (senha && senha.length < SENHA_MINIMA) {
      setErro(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
      return;
    }

    setSalvando(true);
    const resultado = await atualizarUsuario({
      empresaId,
      userId: usuario.id,
      nome: nome.trim(),
      novaSenha: senha || undefined,
      telasOcultas: telasConfiguraveis ? ocultas : undefined,
    });
    setSalvando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }
    // Senha trocada: não fecha calado, porque o painel não mostra a
    // credencial depois e o admin precisa repassá-la.
    if (resultado.aviso) {
      setAviso(resultado.aviso);
      return;
    }
    onFechar();
  }

  return (
    <Modal titulo="Editar usuário" descricao={usuario.email} onFechar={onFechar}>
      <form onSubmit={enviar} className="space-y-4 px-5 py-4">
        {aviso ? (
          <p role="status" className="text-xs text-fg-muted">
            {aviso}
          </p>
        ) : (
          <>
            <Field label="Nome" required>
              <Input
                autoFocus
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setErro(null);
                }}
              />
            </Field>

            <Field
              label="Nova senha"
              hint={`Deixe em branco para manter a atual. Mínimo de ${SENHA_MINIMA} caracteres; anote antes de salvar, o painel não mostra a senha depois.`}
            >
              <Input
                value={senha}
                onChange={(e) => {
                  setSenha(e.target.value);
                  setErro(null);
                }}
                type="password"
                /* `new-password` impede o navegador de preencher aqui as
                   credenciais de quem está logado. */
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </Field>

            {telasConfiguraveis ? (
              <div role="group" aria-label="Telas liberadas" className="space-y-2.5 border-t border-border pt-4">
                <p className="text-sm font-medium">Telas liberadas</p>
                <div className="space-y-2.5">
                  {TELAS.map((tela) => (
                    <div key={tela.chave} className="flex items-center justify-between gap-4">
                      <span className="truncate text-sm text-fg-muted">{tela.rotulo}</span>
                      <Toggle
                        label={`${tela.rotulo}: liberada para ${usuario.nome}`}
                        checked={!ocultas.includes(tela.chave)}
                        onChange={(liberada) => {
                          setOcultas((atuais) =>
                            liberada
                              ? atuais.filter((chave) => chave !== tela.chave)
                              : [...atuais, tela.chave],
                          );
                          setErro(null);
                        }}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-fg-subtle">
                  Vale para esta pessoa nesta empresa. Usuários e Configurações ficam sempre
                  liberados.
                </p>
              </div>
            ) : null}

            {erro ? (
              <p role="alert" className="text-xs text-danger">
                {erro}
              </p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {aviso ? (
            <Button type="button" variant="primary" onClick={onFechar}>
              Fechar
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar"}
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

/**
 * Excluir acesso é irreversível e pode apagar a conta inteira, então pede
 * confirmação com o nome de quem vai sair na frente — um segundo clique em um
 * ícone de lixeira seria fácil demais de dar sem querer.
 */
function ModalExcluir({
  empresaId,
  usuario,
  onFechar,
}: {
  empresaId: string;
  usuario: Usuario;
  onFechar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  async function confirmar() {
    setExcluindo(true);
    const resultado = await excluirUsuario({ empresaId, userId: usuario.id });
    setExcluindo(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }
    if (resultado.aviso) {
      setAviso(resultado.aviso);
      return;
    }
    onFechar();
  }

  return (
    <Modal
      titulo="Excluir usuário"
      descricao={`${usuario.nome} · ${usuario.email}`}
      onFechar={onFechar}
    >
      <div className="space-y-4 px-5 py-4">
        {aviso ? (
          <p role="status" className="text-xs text-fg-muted">
            {aviso}
          </p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              A pessoa perde o acesso a esta empresa. Se esta for a única empresa dela, a
              conta também é apagada, e não há como desfazer.
            </p>
            {erro ? (
              <p role="alert" className="text-xs text-danger">
                {erro}
              </p>
            ) : null}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {aviso ? (
            <Button type="button" variant="primary" onClick={onFechar}>
              Fechar
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onFechar}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={confirmar}
                disabled={excluindo}
              >
                <IconLixeira className="size-4" />
                {excluindo ? "Excluindo…" : "Excluir acesso"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
