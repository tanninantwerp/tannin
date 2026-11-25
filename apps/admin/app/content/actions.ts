'use server';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY } from '@/lib/supabase-keys';
import { TRANSLATION_READY, translate, type Lang } from '@/lib/translate';

const LANGS: Lang[] = ['en', 'nl', 'fr'];

/** True when the caller's own sign-in carries the marketing permission. */
async function canEditContent(accessToken: string): Promise<boolean> {
  if (!accessToken) return false;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await db.rpc('has_perm', { p: 'marketing' });
  return !error && data === true;
}

export type TranslateResult = { ok: true; value: Partial<Record<Lang, string>> } | { ok: false; error: string };

/**
 * Text in one of the site's languages in, the other two out, for the person to
 * check and edit before saving. Nothing is saved here. Server side because the
 * DeepL key must never reach the browser; the caller's sign-in is checked so the
 * key cannot be spent by anyone who finds this endpoint.
 */
export async function translateText(accessToken: string, text: string, from: Lang): Promise<TranslateResult> {
  if (!(await canEditContent(accessToken))) return { ok: false, error: 'Not allowed: this needs the marketing permission.' };
  if (!TRANSLATION_READY()) return { ok: false, error: 'Translation is not set up yet (DEEPL_API_KEY).' };
  if (!LANGS.includes(from)) return { ok: false, error: 'Unknown language.' };
  if (!text.trim()) return { ok: false, error: 'There is no text to translate.' };
  if (text.length > 20000) return { ok: false, error: 'The text is too long to translate at once.' };
  try {
    const targets = LANGS.filter((l) => l !== from);
    const out = await Promise.all(targets.map((to) => translate(text, from, to)));
    return { ok: true, value: Object.fromEntries(targets.map((l, i) => [l, out[i]])) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Translation failed.' };
  }
}
