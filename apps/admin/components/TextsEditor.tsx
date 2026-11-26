'use client';

import { useEffect, useMemo, useState } from 'react';
import { checkText, LOCALES, LOCALE_NAMES, textSections, type L10n, type Locale, type TextDef } from '@tannin/content';
import { deleteSiteText, fetchSiteTexts, saveSiteTexts } from '@tannin/supabase';
import { revalidateHomepage } from '@/app/social/actions';
import { getDb } from '@/lib/supabase';
import { TranslateLink } from '@/components/L10nInput';

/**
 * Every fixed text of the website (headings, buttons, page copy), in the three
 * languages. Brought over from the 58diamonds admin.
 *
 * Sections follow the site. A change, typed or translated, is kept aside
 * until Save; Cancel drops it. "Original" puts the wording from the code back.
 * Row-level security is the real gate: without `marketing`, a save fails.
 */
export function TextsEditor() {
  const sections = useMemo(() => textSections(), []);
  const byKey = useMemo(() => new Map(sections.flatMap((s) => s.texts.map((t) => [t.key, t] as const))), [sections]);
  const sectionOf = useMemo(() => new Map(sections.flatMap((s) => s.texts.map((t) => [t.key, s.name] as const))), [sections]);

  const [saved, setSaved] = useState<Record<string, L10n> | null>(null);
  const [draft, setDraft] = useState<Record<string, L10n>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSiteTexts(getDb())
      .then(setSaved)
      .catch(() => {
        setSaved({});
        setError('Could not read the saved texts. Has the database update (migration 0055) been run?');
      });
  }, []);

  if (!saved) return <p className="mt-6 text-sm text-[var(--text-muted)]">One moment…</p>;

  const current = (t: TextDef): L10n => draft[t.key] ?? { ...t.value, ...strip(saved[t.key]) };
  const changed = (k: string) => draft[k] !== undefined;
  const customised = (k: string) => Object.keys(strip(saved[k])).length > 0;
  const missing = (t: TextDef) => LOCALES.filter((l) => !current(t)[l]?.trim());
  // What is missing on the site now, ignoring unsaved typing, so a text being
  // filled in stays in the "missing" list until it is saved.
  const missingSaved = (t: TextDef) => LOCALES.filter((l) => !({ ...t.value, ...strip(saved[t.key]) } as L10n)[l]?.trim());
  const pending = Object.keys(draft);

  const q = query.trim().toLowerCase();
  const matches = (t: TextDef) =>
    (!onlyMissing || missingSaved(t).length > 0 || changed(t.key)) &&
    (!q || [t.key, t.label, ...Object.values(current(t))].some((v) => v?.toLowerCase().includes(q)));
  const filtering = Boolean(q) || onlyMissing;
  const found = filtering ? sections.flatMap((s) => s.texts.filter(matches)) : [];
  const missingTotal = sections.reduce((n, s) => n + s.texts.filter((t) => missingSaved(t).length > 0).length, 0);

  function problem(k: string): string | null {
    const t = byKey.get(k)!;
    const v = draft[k];
    if (!v) return null;
    for (const l of LOCALES) {
      const text = v[l]?.trim();
      if (!text) continue;
      const why = checkText(t.value.en ?? '', text);
      if (why) return `${LOCALE_NAMES[l]}: ${why}`;
    }
    return null;
  }

  async function save(keys: string[]) {
    const bad = keys.map((k) => [k, problem(k)] as const).find(([, p]) => p);
    if (bad) return setError(`${byKey.get(bad[0])!.label}: ${bad[1]}`);
    setBusy(keys.length === 1 ? keys[0]! : 'all');
    setError(null);
    try {
      // Only what differs from the code is stored, so a later change of the
      // wording in the code still reaches the languages nobody touched here.
      const rows = Object.fromEntries(keys.map((k) => [k, onlyEdits(byKey.get(k)!, draft[k]!)]));
      const toSave = Object.fromEntries(Object.entries(rows).filter(([, v]) => Object.keys(v).length));
      const toDelete = Object.keys(rows).filter((k) => !Object.keys(rows[k]!).length && customised(k));
      await saveSiteTexts(getDb(), toSave);
      await Promise.all(toDelete.map((k) => deleteSiteText(getDb(), k)));
      const next = { ...saved };
      for (const k of keys) {
        if (Object.keys(rows[k]!).length) next[k] = rows[k]!;
        else delete next[k];
      }
      setSaved(next);
      cancel(keys);
      void revalidateHomepage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(null);
  }

  function cancel(keys: string[]) {
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
  }

  async function reset(k: string) {
    if (!window.confirm('Put the original wording back, in all three languages?')) return;
    setBusy(k);
    try {
      await deleteSiteText(getDb(), k);
      setSaved(Object.fromEntries(Object.entries(saved!).filter(([key]) => key !== k)));
      cancel([k]);
      void revalidateHomepage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset.');
    }
    setBusy(null);
  }

  const field = (t: TextDef, showSection = false) => {
    const v = current(t);
    const gaps = missing(t);
    const set = (next: L10n) => setDraft((d) => ({ ...d, [t.key]: next }));
    return (
      <li key={t.key} className="card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-[var(--fs-body)] font-medium">{t.label}</span>
          {showSection && <span className="text-[var(--fs-label)] text-[var(--text-muted)]">{sectionOf.get(t.key)}</span>}
          {gaps.length > 0 && !changed(t.key) && (
            <span className="text-[var(--fs-label)] text-[var(--warn)]">No {gaps.map((l) => LOCALE_NAMES[l]).join(', ')}</span>
          )}
          {customised(t.key) && !changed(t.key) && (
            <button type="button" disabled={busy !== null} onClick={() => reset(t.key)} className="text-[var(--fs-label)] underline underline-offset-2">
              Original
            </button>
          )}
          {changed(t.key) && (
            <>
              <button type="button" disabled={busy !== null} onClick={() => save([t.key])} className="btn btn-primary min-h-9">
                {busy === t.key ? 'Saving…' : 'Save'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => cancel([t.key])} className="btn btn-quiet min-h-9">
                Cancel
              </button>
            </>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {LOCALES.map((l) => (
            <label key={l} className="flex flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[var(--fs-label)] uppercase tracking-[0.14em] text-[var(--text-muted)]">{LOCALE_NAMES[l]}</span>
                <TranslateLink value={v} from={l} onChange={set} />
              </span>
              {t.multiline ? (
                <textarea lang={l} rows={4} value={v[l] ?? ''} placeholder={l === 'en' ? '' : v.en ?? ''} onChange={(e) => set({ ...v, [l]: e.target.value })} className="field resize-y" />
              ) : (
                <input lang={l} value={v[l] ?? ''} placeholder={l === 'en' ? '' : v.en ?? ''} onChange={(e) => set({ ...v, [l]: e.target.value })} className="field min-h-11" />
              )}
            </label>
          ))}
        </div>
        {changed(t.key) && problem(t.key) && <p className="text-[var(--fs-label)] text-[var(--danger)]">{problem(t.key)}</p>}
      </li>
    );
  };

  return (
    <main className="admin-main">
      <h1 className="page-title">Texts</h1>
      <p className="page-dek">
        Headings, buttons and page texts across the website, in English, Dutch and French. Open a section to change its texts. A change, typed or
        translated, is only kept once you press Save; Cancel puts it back, and Original returns to the starting wording. Words in {'{braces}'} are filled in
        by the site (a name, a number): keep them as they are. An empty language shows the English text on the site.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all texts" aria-label="Search texts" className="field min-h-11 max-w-72" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Only texts missing a language ({missingTotal})
        </label>
        {pending.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            {pending.length === 1 ? '1 change not saved' : `${pending.length} changes not saved`}
            <button type="button" disabled={busy !== null} onClick={() => save(pending)} className="btn btn-primary min-h-11">
              {busy === 'all' ? 'Saving…' : 'Save all'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => cancel(pending)} className="btn btn-quiet min-h-11">
              Cancel all
            </button>
          </span>
        )}
      </div>
      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      {filtering ? (
        found.length ? (
          <ul className="mt-6 flex flex-col gap-3">{found.slice(0, 200).map((t) => field(t, true))}</ul>
        ) : (
          <p className="mt-6 text-sm text-[var(--text-muted)]">No text matches.</p>
        )
      ) : (
        <ol className="mt-6 flex flex-col gap-2">
          {sections.map((s) => {
            const isOpen = open === s.name;
            const unsaved = s.texts.filter((t) => changed(t.key)).length;
            const edited = s.texts.filter((t) => customised(t.key)).length;
            return (
              <li key={s.name} className="card">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.name)} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={`inline-block w-3 text-xs transition ${isOpen ? 'rotate-90' : ''}`} aria-hidden>
                    ›
                  </span>
                  <span className="flex-1">{s.name}</span>
                  {unsaved > 0 && <span className="text-[var(--fs-label)] text-[var(--warn)]">{unsaved} not saved</span>}
                  {edited > 0 && <span className="text-[var(--fs-label)] text-[var(--accent)]">{edited} changed by you</span>}
                  <span className="text-[var(--fs-label)] text-[var(--text-muted)]">{s.texts.length === 1 ? '1 text' : `${s.texts.length} texts`}</span>
                </button>
                {isOpen && <ul className="flex flex-col gap-3 border-t border-[var(--surface-edge)] p-3">{s.texts.map((t) => field(t))}</ul>}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function strip(v: L10n | undefined): L10n {
  return Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x?.trim())) as L10n;
}

/** The languages that differ from the wording in the code (trimmed, empty dropped). */
function onlyEdits(t: TextDef, v: L10n): L10n {
  const out: L10n = {};
  for (const l of LOCALES as readonly Locale[]) {
    const text = v[l]?.trim();
    if (text && text !== t.value[l]?.trim()) out[l] = text;
  }
  return out;
}
