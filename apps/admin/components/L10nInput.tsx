'use client';

import { useState } from 'react';
import { LOCALES, LOCALE_NAMES, type L10n, type Locale } from '@tannin/content';
import { translateText } from '@/app/content/actions';
import { getDb } from '@/lib/supabase';

/**
 * One text in English, Dutch and French, side by side, each with a
 * "Translate" link that fills the other two from it (DeepL). A translation is
 * only a suggestion in the fields until the screen's own Save.
 */
export function L10nInput({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder,
  hint,
}: {
  label: string;
  value: L10n;
  onChange: (v: L10n) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: L10n;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[var(--fs-body)] font-medium">{label}</span>
      <div className="grid gap-3 md:grid-cols-3">
        {LOCALES.map((l) => (
          <label key={l} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[var(--fs-label)] uppercase tracking-[0.14em] text-[var(--text-muted)]">{LOCALE_NAMES[l]}</span>
              <TranslateLink value={value} from={l} onChange={onChange} />
            </span>
            {multiline ? (
              <textarea
                lang={l}
                rows={rows}
                value={value[l] ?? ''}
                placeholder={placeholder?.[l] ?? ''}
                onChange={(e) => onChange({ ...value, [l]: e.target.value })}
                className="field resize-y"
              />
            ) : (
              <input
                lang={l}
                value={value[l] ?? ''}
                placeholder={placeholder?.[l] ?? ''}
                onChange={(e) => onChange({ ...value, [l]: e.target.value })}
                className="field min-h-11"
              />
            )}
          </label>
        ))}
      </div>
      {hint && <p className="text-[var(--fs-label)] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

/** Fills the other two languages from this one. Hidden while this language is empty. */
export function TranslateLink({ value, from, onChange }: { value: L10n; from: Locale; onChange: (v: L10n) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!value[from]?.trim()) return null;

  async function run() {
    setBusy(true);
    setError(null);
    const { data } = await getDb().auth.getSession();
    const r = await translateText(data.session?.access_token ?? '', value[from] ?? '', from);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onChange({ ...value, ...r.value });
  }

  return (
    <span className="flex items-baseline gap-2">
      {error && <span className="text-[var(--fs-label)] text-[var(--danger)]">{error}</span>}
      <button type="button" disabled={busy} onClick={run} className="text-[var(--fs-label)] underline underline-offset-2 disabled:opacity-50" title={`Fill the other two languages from ${LOCALE_NAMES[from]}`}>
        {busy ? 'Translating…' : 'Translate'}
      </button>
    </span>
  );
}
