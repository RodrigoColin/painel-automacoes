"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  IconDesfazer,
  IconListaMarcadores,
  IconListaNumerada,
  IconRefazer,
} from "@/components/icons";
import { clsx } from "@/lib/clsx";

/**
 * Texto de antes do editor (puro, com quebras de linha) vira parágrafos; o
 * que já é HTML passa direto.
 */
function comoHtml(valor: string) {
  if (!valor || valor.trimStart().startsWith("<")) return valor;
  const escapar = (linha: string) =>
    linha.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return valor
    .split(/\n/)
    .map((linha) => `<p>${escapar(linha)}</p>`)
    .join("");
}

/**
 * Editor de texto com formatação básica: negrito, itálico, sublinhado,
 * tachado, subtítulo, listas e desfazer/refazer.
 *
 * O valor é HTML. Ele só deve ser exibido por este mesmo componente: o Tiptap
 * relê o HTML pelo próprio esquema e descarta tag, atributo ou script que não
 * faça parte dele. Não jogue esse valor num `dangerouslySetInnerHTML`.
 *
 * Não controlado de propósito: `valor` é só o conteúdo inicial. Para trocar de
 * documento, remonte com `key`.
 */
export function EditorRico({
  valor,
  onMudar,
  rotulo,
  desabilitado = false,
}: {
  valor: string;
  /** Recebe o HTML a cada edição; `""` quando o editor fica vazio. */
  onMudar: (html: string) => void;
  /** Nome acessível da área de texto. */
  rotulo: string;
  desabilitado?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Fora do que a barra oferece: menos superfície e nada que o usuário
        // crie por atalho sem ter como desfazer pelo botão.
        link: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        heading: { levels: [3] },
      }),
    ],
    content: comoHtml(valor),
    editable: !desabilitado,
    // O Next renderiza no servidor primeiro; sem isto o Tiptap acusa
    // divergência de hidratação.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": rotulo,
        class: clsx(
          "min-h-28 px-3 py-2 text-sm focus:outline-none",
          "[&_p]:my-1 [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold",
          "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_li>p]:my-0 [&_strong]:font-semibold",
        ),
      },
    },
    onUpdate: ({ editor: atual }) => onMudar(atual.isEmpty ? "" : atual.getHTML()),
  });

  return (
    <div
      className={clsx(
        "rounded-md border border-border bg-surface focus-within:ring-2 focus-within:ring-ring",
        desabilitado && "opacity-60",
      )}
    >
      {editor && !desabilitado ? <Barra editor={editor} /> : null}
      <EditorContent editor={editor} className="max-h-72 overflow-y-auto" />
    </div>
  );
}

function Barra({ editor }: { editor: Editor }) {
  // O Tiptap 3 não re-renderiza a cada transação; este seletor é o que mantém
  // os botões acesos conforme o cursor anda pelo texto.
  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      negrito: e.isActive("bold"),
      italico: e.isActive("italic"),
      sublinhado: e.isActive("underline"),
      tachado: e.isActive("strike"),
      subtitulo: e.isActive("heading", { level: 3 }),
      marcadores: e.isActive("bulletList"),
      numerada: e.isActive("orderedList"),
      podeDesfazer: e.can().undo(),
      podeRefazer: e.can().redo(),
    }),
  });

  const foco = () => editor.chain().focus();

  return (
    <div role="toolbar" aria-label="Formatação" className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
      <Botao rotulo="Negrito" ativo={estado.negrito} onClick={() => foco().toggleBold().run()}>
        <span className="font-bold">N</span>
      </Botao>
      <Botao rotulo="Itálico" ativo={estado.italico} onClick={() => foco().toggleItalic().run()}>
        <span className="font-serif italic">I</span>
      </Botao>
      <Botao rotulo="Sublinhado" ativo={estado.sublinhado} onClick={() => foco().toggleUnderline().run()}>
        <span className="underline underline-offset-2">S</span>
      </Botao>
      <Botao rotulo="Tachado" ativo={estado.tachado} onClick={() => foco().toggleStrike().run()}>
        <span className="line-through">T</span>
      </Botao>

      <Separador />

      <Botao rotulo="Subtítulo" ativo={estado.subtitulo} onClick={() => foco().toggleHeading({ level: 3 }).run()}>
        <span className="text-xs font-semibold">H</span>
      </Botao>
      <Botao rotulo="Lista com marcadores" ativo={estado.marcadores} onClick={() => foco().toggleBulletList().run()}>
        <IconListaMarcadores className="size-4" />
      </Botao>
      <Botao rotulo="Lista numerada" ativo={estado.numerada} onClick={() => foco().toggleOrderedList().run()}>
        <IconListaNumerada className="size-4" />
      </Botao>

      <Separador />

      <Botao rotulo="Desfazer" desabilitado={!estado.podeDesfazer} onClick={() => foco().undo().run()}>
        <IconDesfazer className="size-4" />
      </Botao>
      <Botao rotulo="Refazer" desabilitado={!estado.podeRefazer} onClick={() => foco().redo().run()}>
        <IconRefazer className="size-4" />
      </Botao>
    </div>
  );
}

function Separador() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />;
}

function Botao({
  rotulo,
  ativo,
  desabilitado,
  onClick,
  children,
}: {
  rotulo: string;
  ativo?: boolean;
  desabilitado?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      disabled={desabilitado}
      // Sem isto o clique tira o foco (e a seleção) do texto antes do comando.
      onMouseDown={(evento) => evento.preventDefault()}
      onClick={onClick}
      className={clsx(
        "grid size-8 place-items-center rounded text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        ativo ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
