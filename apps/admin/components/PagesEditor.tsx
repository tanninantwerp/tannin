'use client';

import { useCallback, useEffect, useState } from 'react';
import { RESERVED_SLUGS, slugify } from '@tannin/content';
import {
  createPage,
  deletePage,
  fetchAllPages,
  reorderPages,
  updatePage,
  uploadMediaFile,
  type SitePage,
  type SitePageInput,
} from '@tannin/supabase';
import { revalidateHomepage } from '@/app/social/actions';
import { getDb } from '@/lib/supabase';
import { L10nInput } from '@/components/L10nInput';

const EMPTY: SitePageInput = {
  slug: '',
  title: {},
  body: {},
  imageUrl: null,
  seoTitle: {},
  seoDescription: {},
  published: false,
  inFooter: false,
};

const SITE = (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://ta-nnin.be').replace(/\/$/, '');

const MARKDOWN_HINT =
  'An empty line starts a new paragraph. "## " at the start of a line makes a heading, "- " a list, "> " a quote. **bold**, *italic*, [words](https://address) for a link, or [words](wine) for a page of the site.';

/**
 * Pages staff add themselves (private events, jobs, a press page...), with
 * their own text in three languages and an optional photo. Brought over from
 * the 58diamonds admin.
 *
 * A new page starts as a draft. "In the footer" adds a link to it at the bottom
 * of every page. The order here is the order in the footer.
 */
export function PagesEditor() {
  const [rows, setRows] = useState<SitePage[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<SitePageInput>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchAllPages(getDb()));
    } catch {
      setRows([]);
      setError('Could not read the pages. Has the database update (migration 0055) been run?');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setDraft(EMPTY);
    setSlugTouched(false);
    setError(null);
    setEditing('new');
  }

  function openEdit(p: SitePage) {
    setDraft({
      slug: p.slug,
      title: p.title,
      body: p.body,
      imageUrl: p.imageUrl,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      published: p.published,
      inFooter: p.inFooter,
    });
    setSlugTouched(true);
    setError(null);
    setEditing(p.id);
  }

  const slug = slugTouched ? slugify(draft.slug) : slugify(draft.title.en ?? draft.title.nl ?? draft.title.fr ?? '');

  async function save() {
    if (!draft.title.en?.trim() && !draft.title.nl?.trim() && !draft.title.fr?.trim()) return setError('Give the page a title.');
    if (!slug) return setError('Give the page a web address.');
    if (RESERVED_SLUGS.includes(slug)) return setError(`“${slug}” is already used by the site itself. Choose another web address.`);
    if (rows?.some((r) => r.slug === slug && r.id !== editing)) return setError(`Another page already uses “${slug}”.`);
    setBusy(true);
    setError(null);
    try {
      const page = { ...draft, slug };
      if (editing === 'new') await createPage(getDb(), page);
      else if (editing) await updatePage(getDb(), editing, page);
      await load();
      setEditing(null);
      void revalidateHomepage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  }

  async function remove(p: SitePage) {
    if (!window.confirm(`Delete the page “${p.title.en || p.slug}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deletePage(getDb(), p.id);
      await load();
      if (editing === p.id) setEditing(null);
      void revalidateHomepage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
    setBusy(false);
  }

  async function move(i: number, by: -1 | 1) {
    if (!rows) return;
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setRows(next);
    try {
      await reorderPages(getDb(), next.map((r) => r.id));
      void revalidateHomepage();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the order.');
      load();
    }
  }

  async function pickImage(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadMediaFile(getDb(), file, 'pages');
      setDraft((d) => ({ ...d, imageUrl: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that image.');
    }
    setUploading(false);
  }

  const set = (patch: Partial<SitePageInput>) => setDraft((d) => ({ ...d, ...patch }));

  const form = (
    <div className="card mt-6 flex flex-col gap-5 p-4">
      <L10nInput label="Title" value={draft.title} onChange={(title) => set({ title })} />
      <L10nInput label="Text" value={draft.body} onChange={(body) => set({ body })} multiline rows={14} hint={MARKDOWN_HINT} />

      <div className="flex flex-col gap-2">
        <span className="text-[var(--fs-body)] font-medium">Photo at the top (optional)</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn btn-quiet min-h-11 cursor-pointer">
            {uploading ? 'Uploading…' : draft.imageUrl ? 'Change photo' : 'Choose a photo'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
          </label>
          {draft.imageUrl && (
            <button type="button" onClick={() => set({ imageUrl: null })} className="btn btn-quiet min-h-11">
              Remove photo
            </button>
          )}
        </div>
        {draft.imageUrl && <img src={draft.imageUrl} alt="" className="max-h-40 w-auto rounded border border-[var(--surface-edge)] object-cover" />}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[var(--fs-body)] font-medium">Web address</span>
        <span className="flex flex-wrap items-center gap-1 text-[var(--fs-body)] text-[var(--text-muted)]">
          {SITE.replace(/^https?:\/\//, '')}/
          <input
            value={slugTouched ? draft.slug : slug}
            onChange={(e) => {
              setSlugTouched(true);
              set({ slug: e.target.value });
            }}
            className="field min-h-11 w-auto flex-1"
          />
        </span>
        <span className="text-[var(--fs-label)] text-[var(--text-muted)]">
          The same in every language: /nl/{slug || '…'} and /fr/{slug || '…'} for Dutch and French. Changing it later breaks links people saved.
        </span>
      </label>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={draft.published} onChange={(e) => set({ published: e.target.checked })} />
          Published (off: visitors get “page not found”)
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={draft.inFooter} onChange={(e) => set({ inFooter: e.target.checked })} />
          Link in the footer
        </label>
      </div>

      <details>
        <summary className="cursor-pointer text-[var(--fs-body)]">Search engines (optional)</summary>
        <div className="mt-4 flex flex-col gap-5">
          <L10nInput label="Title in Google" value={draft.seoTitle} onChange={(seoTitle) => set({ seoTitle })} hint="Empty: the page title. About 60 characters." />
          <L10nInput
            label="Description in Google"
            value={draft.seoDescription}
            onChange={(seoDescription) => set({ seoDescription })}
            multiline
            hint="One or two sentences, about 150 characters. Empty: the start of the text."
          />
        </div>
      </details>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || uploading} className="btn btn-primary min-h-11">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditing(null)} className="btn btn-quiet min-h-11">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <main className="admin-main">
      <h1 className="page-title">Pages</h1>
      <p className="page-dek">
        Pages with your own text and photo, in English, Dutch and French. A new page starts as a draft: write it, tick Published, and tick “Link in the
        footer” to show it at the bottom of the site. The order here is the order in the footer.
      </p>
      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      {editing === 'new' ? (
        form
      ) : (
        <div className="mt-6">
          <button onClick={openNew} className="btn btn-primary min-h-11">
            New page
          </button>
        </div>
      )}

      {!rows ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">One moment…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">No pages yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((p, i) => (
            <li key={p.id} className="flex flex-col">
              <div className="card flex flex-wrap items-center gap-3 p-3">
                <div className="flex flex-col">
                  <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" className="btn btn-quiet min-h-0 px-2 py-0.5 disabled:opacity-30">
                    ↑
                  </button>
                  <button disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down" className="btn btn-quiet min-h-0 px-2 py-0.5 disabled:opacity-30">
                    ↓
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-medium">{p.title.en || p.title.nl || p.title.fr || p.slug}</p>
                  <p className="text-[var(--fs-label)] text-[var(--text-muted)]">
                    /{p.slug} · {p.published ? 'Published' : 'Draft'}
                    {p.inFooter ? ' · In the footer' : ''}
                  </p>
                </div>
                {p.published && (
                  <a href={`${SITE}/${p.slug}`} target="_blank" rel="noreferrer" className="text-[var(--fs-label)] underline underline-offset-2">
                    View
                  </a>
                )}
                <button onClick={() => openEdit(p)} className="btn btn-quiet min-h-11">
                  Edit
                </button>
                <button onClick={() => remove(p)} disabled={busy} className="btn btn-quiet min-h-11 text-[var(--danger)]">
                  Delete
                </button>
              </div>
              {editing === p.id && form}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
