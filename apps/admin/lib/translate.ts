/**
 * Translation between English, Dutch and French with DeepL
 * (deepl.com/pro-api), as in the 58diamonds admin. The free "API Free" plan
 * gives 500,000 characters a month. Without DEEPL_API_KEY the admin says
 * translation is not set up, and everything else works.
 */

export type Lang = 'en' | 'nl' | 'fr';

export const TRANSLATION_READY = () => Boolean(process.env.DEEPL_API_KEY);

export async function translate(text: string, from: Lang, to: Lang): Promise<string> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error('Translation is not set up yet (DEEPL_API_KEY).');
  const body = JSON.stringify({
    text: [protect(text)],
    source_lang: from.toUpperCase(),
    // DeepL wants a variant for English; the site writes British English.
    target_lang: to === 'en' ? 'EN-GB' : to.toUpperCase(),
    // As the site already writes: "je" in Dutch, "vous" in French.
    formality: to === 'fr' ? 'prefer_more' : 'prefer_less',
    preserve_formatting: true,
    tag_handling: 'xml',
    ignore_tags: ['k'],
  });
  // Free keys (ending in ":fx") use their own host; a key sent to the wrong
  // one is refused with 403, so the other host is tried once.
  const hosts = key.endsWith(':fx') ? ['https://api-free.deepl.com', 'https://api.deepl.com'] : ['https://api.deepl.com', 'https://api-free.deepl.com'];
  const call = (host: string) =>
    fetch(`${host}/v2/translate`, { method: 'POST', headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' }, body });
  let res = await call(hosts[0]!);
  if (res.status === 403) res = await call(hosts[1]!);
  if (!res.ok) throw new Error(res.status === 456 ? 'The translation allowance is used up.' : `Translation failed (${res.status}).`);
  const json = (await res.json()) as { translations?: { text: string }[] };
  return restore(json.translations?.[0]?.text ?? '');
}

/** {placeholders} (and everything inside a {count, plural, ...}) must come back untouched. */
function protect(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '';
  let depth = 0;
  for (const c of escaped) {
    if (c === '{') {
      if (depth === 0) out += '<k>';
      depth++;
      out += c;
    } else if (c === '}') {
      out += c;
      depth = Math.max(0, depth - 1);
      if (depth === 0) out += '</k>';
    } else out += c;
  }
  return depth === 0 ? out : escaped;
}

function restore(text: string): string {
  return text.replace(/<\/?k>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
