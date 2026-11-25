import type { ReactNode } from 'react';

/**
 * Renders the simple Markdown typed in Admin > Pages: paragraphs, "## " and
 * "### " headings, "- " lists, "> " quotes, **bold**, *italic* and
 * [links](address). Never raw HTML, so nothing typed can break the page.
 * Brought over from the 58diamonds site.
 *
 * A link to a bare word ([our wines](wine)) points to that page of the site
 * in the reader's language.
 */
export function Markdown({ text, locale }: { text: string; locale: string }) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-7 text-[1.02rem] leading-[1.75]">
      {blocks.map((block, i) => {
        if (block.startsWith('### '))
          return (
            <h3 key={i} className="mt-4 text-[0.78rem] uppercase tracking-[0.2em]">
              {inline(block.slice(4), locale)}
            </h3>
          );
        if (block.startsWith('## ')) {
          const [head = '', ...rest] = block.split('\n');
          return (
            <div key={i} className="mt-6 flex flex-col gap-5">
              <h2 className="font-[family-name:var(--font-voces)] text-2xl leading-snug sm:text-3xl">{inline(head.slice(3), locale)}</h2>
              {rest.length > 0 && <Markdown text={rest.join('\n')} locale={locale} />}
            </div>
          );
        }
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('>')))
          return (
            <blockquote key={i} className="border-l-2 border-[var(--accent)] py-1 pl-6 font-[family-name:var(--font-voces)] text-2xl leading-snug">
              {lines.map((l, j) => line(l.replace(/^>\s?/, ''), j, locale))}
            </blockquote>
          );
        const listStart = lines.findIndex((l) => l.startsWith('- '));
        if (listStart >= 0 && lines.slice(listStart).every((l) => l.startsWith('- '))) {
          return (
            <div key={i}>
              {listStart > 0 && <p>{lines.slice(0, listStart).map((l, j) => line(l, j, locale))}</p>}
              <ul className="ml-5 list-disc">
                {lines.slice(listStart).map((l, j) => (
                  <li key={j}>{inline(l.slice(2), locale)}</li>
                ))}
              </ul>
            </div>
          );
        }
        return <p key={i}>{lines.map((l, j) => line(l, j, locale))}</p>;
      })}
    </div>
  );
}

function line(text: string, j: number, locale: string) {
  return (
    <span key={j}>
      {j > 0 && <br />}
      {inline(text, locale)}
    </span>
  );
}

// *italic* needs a word right inside the stars, so a lone "(*)" stays as typed.
const TOKEN = /\*\*(.+?)\*\*|\*(?![\s)])(.+?)(?<![\s(])\*(?!\))|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+[^\s).,;])/g;

export function inline(text: string, locale: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (m[1]) out.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={key}>{m[2]}</em>);
    else if (m[3] && m[4]) out.push(<SmartLink key={key} href={m[4]} locale={locale}>{m[3]}</SmartLink>);
    else if (m[5]) out.push(<SmartLink key={key} href={m[5]} locale={locale}>{m[5].replace(/^https?:\/\//, '')}</SmartLink>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Where a typed link goes; null for anything that is not a plain web, mail or phone link. */
export function linkTarget(href: string, locale: string): { href: string; external: boolean } | null {
  if (/^(mailto:|tel:)/i.test(href)) return { href, external: false };
  if (/^https?:/i.test(href)) return { href, external: true };
  if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return null;
  if (href.startsWith('/')) return { href, external: false };
  const path = href.replace(/^\.?\/?/, '');
  return { href: locale === 'en' ? `/${path}` : `/${locale}/${path}`, external: false };
}

function SmartLink({ href, locale, children }: { href: string; locale: string; children: ReactNode }) {
  const target = linkTarget(href, locale);
  if (!target) return <>{children}</>;
  return (
    <a
      href={target.href}
      className="underline underline-offset-4 hover:text-[var(--accent)]"
      {...(target.external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

/** Markdown to one plain line, for a search-engine description. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
