'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createEvent,
  deleteEvent,
  fetchAllEvents,
  reorderEvents,
  updateEvent,
  uploadMediaFile,
} from '@tannin/supabase';
import type { EventItem, EventKind } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';

const KINDS: { value: EventKind; label: string }[] = [
  { value: 'cafe-society', label: 'Café society' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'cellar', label: 'With CE-LLAR' },
  { value: 'other', label: 'Other' },
];

const KIND_LABEL: Record<EventKind, string> = {
  'cafe-society': 'Café society',
  workshop: 'Workshop',
  cellar: 'With CE-LLAR',
  other: 'Other',
};

const EMPTY = {
  title: '',
  slug: '',
  kind: 'cafe-society' as EventKind,
  startsOn: '',
  location: '',
  summary: '',
  body: '',
  imageUrl: '',
  sourceUrl: '',
  sourceAccount: '' as '' | 'tannin' | 'cellar',
  published: true,
};
type Draft = typeof EMPTY;

/** A URL-safe slug from a title: "Café Society #3" → "cafe-society-3". */
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * What's-on, for whoever holds the marketing permission.
 *
 * The order here is the order on the website - arrange with the arrows. Row-level
 * security is the real gate; if someone without `marketing` reaches this, every
 * save simply fails.
 */
export function EventsEditor() {
  const [rows, setRows] = useState<EventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // `editing` is an event id, 'new' for the add form, or null for neither.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function pickImage(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadMediaFile(getDb(), file, 'events');
      setDraft((d) => ({ ...d, imageUrl: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that image.');
    }
    setUploading(false);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchAllEvents(getDb()));
    } catch {
      // No events (or the table isn't there yet) reads the same as empty - a
      // real failure shows up when you try to save.
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setDraft(EMPTY);
    setSlugTouched(false);
    setEditing('new');
  }

  function openEdit(ev: EventItem) {
    setDraft({
      title: ev.title,
      slug: ev.slug,
      kind: ev.kind,
      startsOn: ev.startsOn ?? '',
      location: ev.location ?? '',
      summary: ev.summary ?? '',
      body: ev.body ?? '',
      imageUrl: ev.imageUrl ?? '',
      sourceUrl: ev.sourceUrl ?? '',
      sourceAccount: ev.sourceAccount ?? '',
      published: ev.published,
    });
    setSlugTouched(true);
    setEditing(ev.id);
  }

  function setTitle(title: string) {
    setDraft((d) => ({ ...d, title, slug: slugTouched ? d.slug : slugify(title) }));
  }

  async function save() {
    const slug = (slugTouched ? draft.slug : slugify(draft.title)).trim();
    if (!draft.title.trim() || !slug) {
      setError('An event needs a title.');
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      slug,
      title: draft.title,
      kind: draft.kind,
      startsOn: draft.startsOn || null,
      location: draft.location || null,
      summary: draft.summary || null,
      body: draft.body || null,
      imageUrl: draft.imageUrl || null,
      sourceUrl: draft.sourceUrl || null,
      sourceAccount: draft.sourceAccount || null,
      published: draft.published,
    };
    try {
      if (editing === 'new') await createEvent(getDb(), input);
      else if (editing) await updateEvent(getDb(), editing, input);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the event.');
    }
    setBusy(false);
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteEvent(getDb(), id);
      if (editing === id) setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that event.');
    }
  }

  async function move(index: number, delta: number) {
    if (!rows) return;
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next); // optimistic
    try {
      await reorderEvents(getDb(), next.map((e) => e.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reorder.');
      await load();
    }
  }

  return (
    <main className="admin-main">
      <h1 className="page-title">Events</h1>
      <p className="page-dek">
        What&apos;s on - café society nights, workshops, things with CE-LLAR. The order here is the
        order on the website; use the arrows. Unpublished events are hidden from the site but kept.
      </p>

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      <div className="mt-6">
        {editing ? (
          <div className="card p-4">
            <div className="flex flex-col gap-3">
              <input
                value={draft.title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title - Café Society #4"
                aria-label="Title"
                className="field min-h-11"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as EventKind })}
                  aria-label="Kind"
                  className="field min-h-11 w-auto"
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={draft.startsOn}
                  onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
                  aria-label="Date"
                  className="field min-h-11 w-auto"
                />
                <input
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  placeholder="Where - Ta-nnin, CE-LLAR…"
                  aria-label="Location"
                  className="field min-h-11 flex-1"
                />
              </div>
              <input
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="One line, shown on the card and in search results"
                aria-label="Summary"
                className="field min-h-11"
              />
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="The full description…"
                aria-label="Description"
                rows={4}
                className="field"
              />
              {/* Image: upload a file (public URL comes back and fills the field),
                  or paste a URL directly. The preview below shows whichever one is
                  set so the wrong file is caught before Save. */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="btn btn-quiet min-h-11 cursor-pointer">
                    {uploading ? 'Uploading…' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        void pickImage(e.target.files?.[0] ?? null);
                        e.target.value = '';
                      }}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                  <input
                    value={draft.imageUrl}
                    onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                    placeholder="…or paste an image URL"
                    aria-label="Image URL"
                    className="field min-h-11 flex-1"
                  />
                  {draft.imageUrl && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, imageUrl: '' })}
                      className="btn btn-quiet min-h-11"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {draft.imageUrl && (
                  <img
                    src={draft.imageUrl}
                    alt=""
                    className="max-h-40 w-auto rounded border border-[var(--border)] object-cover"
                  />
                )}
              </div>
              {/* Instagram provenance: the post it came from, and which account,
                  so the public card can show "Seen on @…". Both optional. */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={draft.sourceUrl}
                  onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
                  placeholder="Instagram post URL (optional)"
                  aria-label="Instagram post URL"
                  className="field min-h-11 w-auto flex-1"
                />
                <select
                  value={draft.sourceAccount}
                  onChange={(e) =>
                    setDraft({ ...draft, sourceAccount: e.target.value as Draft['sourceAccount'] })
                  }
                  aria-label="Instagram account"
                  className="field min-h-11 w-auto"
                >
                  <option value="">No account</option>
                  <option value="tannin">@tannin_antwerp</option>
                  <option value="cellar">@cellar_antwerp</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={draft.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setDraft({ ...draft, slug: e.target.value });
                  }}
                  placeholder="url-slug"
                  aria-label="URL slug"
                  className="field min-h-11 w-auto flex-1"
                />
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
                  />
                  Published
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={save} disabled={busy} className="btn btn-primary min-h-11">
                  {busy ? 'Saving…' : editing === 'new' ? 'Add event' : 'Save'}
                </button>
                <button onClick={() => setEditing(null)} className="btn btn-quiet min-h-11">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={openNew} className="btn btn-primary min-h-11">
            + New event
          </button>
        )}
      </div>

      {rows === null ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">One moment…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">No events yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((ev, i) => (
            <li key={ev.id} className="card flex flex-wrap items-center gap-3 p-3">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="btn btn-quiet min-h-0 px-2 py-0.5 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                  className="btn btn-quiet min-h-0 px-2 py-0.5 disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9rem] font-medium">
                  {ev.title}
                  {!ev.published && (
                    <span className="ml-2 text-[var(--fs-label)] text-[var(--text-muted)]">draft</span>
                  )}
                </p>
                <p className="text-[var(--fs-label)] text-[var(--text-muted)]">
                  {KIND_LABEL[ev.kind]}
                  {ev.startsOn ? ` · ${ev.startsOn}` : ''}
                  {ev.location ? ` · ${ev.location}` : ''}
                </p>
              </div>
              <button onClick={() => openEdit(ev)} className="btn btn-quiet min-h-11">
                Edit
              </button>
              <button onClick={() => remove(ev.id)} className="btn btn-quiet min-h-11">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
