'use client';

import { useEffect, useState } from 'react';
import { fetchDayNote, setDayNote } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';

/**
 * A shared note for one service day - "VIP at 8, chef running late" - not
 * tied to any one booking. Mounted on both Today and the Day plan, keyed by
 * whichever date they're showing, so it reads the same wherever staff look.
 */
export function DayNote({ date }: { date: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setEditing(false);
    fetchDayNote(getDb(), date)
      .then((n) => {
        if (!cancelled) setNote(n?.note ?? '');
      })
      .catch(() => {
        if (!cancelled) setNote('');
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function save() {
    setSaving(true);
    try {
      await setDayNote(getDb(), date, draft);
      setNote(draft.trim());
      setEditing(false);
    } catch {
      // Leaves the editor open with what was typed, rather than losing it.
    } finally {
      setSaving(false);
    }
  }

  if (note === null) return null;

  if (editing) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="A note for everyone working today…"
          aria-label="Note for today"
          className="field w-full max-w-md"
        />
        <button onClick={save} disabled={saving} className="btn btn-primary">
          Save
        </button>
        <button onClick={() => setEditing(false)} disabled={saving} className="btn btn-quiet">
          Cancel
        </button>
      </div>
    );
  }

  if (!note) {
    return (
      <button
        onClick={() => {
          setDraft('');
          setEditing(true);
        }}
        className="btn btn-quiet mt-3"
      >
        + Add a note for today
      </button>
    );
  }

  return (
    <div className="card mt-3 flex items-start justify-between gap-2 p-3">
      <p className="text-sm">{note}</p>
      <button
        onClick={() => {
          setDraft(note);
          setEditing(true);
        }}
        className="btn btn-quiet shrink-0"
      >
        Edit
      </button>
    </div>
  );
}
