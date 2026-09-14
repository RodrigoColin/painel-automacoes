import { clsx } from "@/lib/clsx";

/*
 * Logos dos serviços externos que o painel integra.
 *
 * Os arquivos ficam em `public/logos`, e não apontam para o GitHub ou para um
 * CDN: a tela não deve depender de um host de terceiros para desenhar a
 * própria interface, e um ícone que some quando o CDN cai é pior do que a
 * sigla que estava aqui antes.
 *
 * `img` e não `next/image`: são dois arquivos pequenos, exibidos entre 16 e
 * 36 px, sem nada a otimizar.
 */

/** Marca do n8n. PNG largo e transparente — precisa de `object-contain`. */
export function LogoN8n({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logos/n8n.png"
      alt="n8n"
      className={clsx("object-contain", className)}
    />
  );
}

/** Marca do Infisical. Quadrada e com fundo próprio — arredonda junto à caixa. */
export function LogoInfisical({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logos/infisical.png"
      alt="Infisical"
      className={clsx("rounded-[3px] object-cover", className)}
    />
  );
}
