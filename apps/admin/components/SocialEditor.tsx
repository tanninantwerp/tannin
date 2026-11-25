'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  clearStory,
  createSocialPost,
  deleteSocialPost,
  fetchAllSocialPosts,
  fetchAppSettings,
  publishStory,
  reorderSocialPosts,
  updateSocialPost,
  uploadMediaFile,
} from '@tannin/supabase';
import type { CurrentStory, SocialPost } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';
import {
  connectInstagram,
  disconnectInstagram,
  fetchPostImage,
  revalidateHomepage,
  triggerInstagramSync,
} from '@/app/social/actions';

const EMPTY = {
  imageUrl: '',
  label: '@tannin_antwerp',
  title: '',
  href: '',
  published: true,
};
type Draft = typeof EMPTY;

interface IgStatus {
  connected: boolean;
  handle?: string;
  expiresAt?: string;
  lastSynced?: string;
}

/**
 * "From the street" tile curator, for whoever holds the marketing permission.
 *
 * Top panel: connect Instagram and sync automatically.
 * Below: the manual editor - add/edit/remove/reorder tiles directly.
 *
 * Both flows write to the same social_posts table. Instagram-synced posts show
 * a small IG badge; manual posts have none. Posts staff unpublish stay hidden
 * even if re-synced.
 */
export function SocialEditor() {
  const [rows, setRows] = useState<SocialPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Story state
  const [story, setStory] = useState<CurrentStory | null | undefined>(undefined);
  const [storyDraft, setStoryDraft] = useState({ imageUrl: '', href: '', account: '@tannin_antwerp' });
  const [storyUploading, setStoryUploading] = useState(false);
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyMsg, setStoryMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showStoryForm, setShowStoryForm] = useState(false);

  // Instagram connection state
  const [igStatus, setIgStatus] = useState<IgStatus | null>(null);
  const [igToken, setIgToken] = useState('');
  const [igHandle, setIgHandle] = useState('@tannin_antwerp');
  const [igBusy, setIgBusy] = useState(false);
  const [igMsg, setIgMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  async function loadStory() {
    try {
      const s = await fetchAppSettings(getDb(), [
        'story_image_url',
        'story_href',
        'story_account',
        'story_expires_at',
      ]);
      if (s.story_image_url && s.story_expires_at && new Date(s.story_expires_at) > new Date()) {
        setStory({
          imageUrl: s.story_image_url,
          href: s.story_href ?? '',
          account: s.story_account ?? '@tannin_antwerp',
          expiresAt: s.story_expires_at,
        });
      } else {
        setStory(null);
      }
    } catch {
      setStory(null);
    }
  }

  async function loadIgStatus() {
    try {
      const s = await fetchAppSettings(getDb(), [
        'instagram_account_handle',
        'instagram_token_expires_at',
        'instagram_last_synced_at',
      ]);
      if (s.instagram_account_handle) {
        setIgStatus({
          connected: true,
          handle: s.instagram_account_handle,
          expiresAt: s.instagram_token_expires_at,
          lastSynced: s.instagram_last_synced_at,
        });
      } else {
        setIgStatus({ connected: false });
      }
    } catch {
      setIgStatus({ connected: false });
    }
  }

  async function pickImage(file: File | null) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadMediaFile(getDb(), file, 'social');
      setDraft((d) => ({ ...d, imageUrl: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that image.');
    }
    setUploading(false);
  }

  async function fetchFromUrl(url: string, target: 'post' | 'story') {
    const trimmed = url.trim();
    if (!trimmed.includes('instagram.com/p/')) {
      setError('Paste an Instagram post URL first (instagram.com/p/…).');
      return;
    }
    setFetching(true);
    setError(null);
    const result = await fetchPostImage(trimmed);
    setFetching(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not fetch image.');
      return;
    }
    if (target === 'post') {
      setDraft((d) => ({
        ...d,
        imageUrl: result.imageUrl ?? d.imageUrl,
        title: result.title ?? d.title,
        label: result.label ?? d.label,
      }));
    } else {
      setStoryDraft((d) => ({
        ...d,
        imageUrl: result.imageUrl ?? d.imageUrl,
      }));
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchAllSocialPosts(getDb()));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadIgStatus();
    loadStory();
  }, [load]);

  function openNew() {
    setDraft(EMPTY);
    setEditing('new');
  }

  function openEdit(post: SocialPost) {
    setDraft({
      imageUrl: post.imageUrl,
      label: post.label,
      title: post.title,
      href: post.href,
      published: post.published,
    });
    setEditing(post.id);
  }

  async function save() {
    if (!draft.imageUrl.trim() || !draft.title.trim() || !draft.href.trim()) {
      setError('An image, a caption, and an Instagram link are all required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { ...draft };
      if (editing === 'new') await createSocialPost(getDb(), input);
      else if (editing) await updateSocialPost(getDb(), editing, input);
      setEditing(null);
      await Promise.all([load(), revalidateHomepage()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
    setBusy(false);
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteSocialPost(getDb(), id);
      if (editing === id) setEditing(null);
      await Promise.all([load(), revalidateHomepage()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that post.');
    }
  }

  async function move(index: number, delta: number) {
    if (!rows) return;
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    try {
      await reorderSocialPosts(getDb(), next.map((p) => p.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reorder.');
      await load();
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setIgMsg(null);
    setIgBusy(true);
    const result = await connectInstagram(igToken.trim(), igHandle);
    setIgBusy(false);
    if (result.ok) {
      setIgMsg({ kind: 'ok', text: `Connected as @${result.username}.${result.expiresAt ? ` Token valid until ${new Date(result.expiresAt).toLocaleDateString()}.` : ''}` });
      setIgToken('');
      setShowConnect(false);
      await loadIgStatus();
    } else {
      setIgMsg({ kind: 'err', text: result.error ?? 'Connection failed.' });
    }
  }

  async function handleSync() {
    setIgMsg(null);
    setIgBusy(true);
    const result = await triggerInstagramSync();
    setIgBusy(false);
    if (result.ok) {
      setIgMsg({ kind: 'ok', text: `Synced - ${result.synced} post${result.synced === 1 ? '' : 's'} added or updated.` });
      await Promise.all([loadIgStatus(), load(), revalidateHomepage()]);
    } else {
      setIgMsg({ kind: 'err', text: result.error ?? 'Sync failed.' });
    }
  }

  async function handleDisconnect() {
    setIgBusy(true);
    await disconnectInstagram();
    setIgBusy(false);
    setIgStatus({ connected: false });
    setIgMsg(null);
  }

  async function pickStoryImage(file: File | null) {
    if (!file) return;
    setStoryUploading(true);
    try {
      const url = await uploadMediaFile(getDb(), file, 'social');
      setStoryDraft((d) => ({ ...d, imageUrl: url }));
    } catch (e) {
      setStoryMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Upload failed.' });
    }
    setStoryUploading(false);
  }

  async function saveStory(e: React.FormEvent) {
    e.preventDefault();
    if (!storyDraft.imageUrl) return;
    setStoryBusy(true);
    setStoryMsg(null);
    try {
      await publishStory(getDb(), {
        imageUrl: storyDraft.imageUrl,
        href: storyDraft.href,
        account: storyDraft.account,
      });
      setShowStoryForm(false);
      setStoryDraft({ imageUrl: '', href: '', account: '@tannin_antwerp' });
      setStoryMsg({ kind: 'ok', text: 'Story published - visible on the homepage for 24 hours.' });
      await Promise.all([loadStory(), revalidateHomepage()]);
    } catch (e) {
      setStoryMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not publish.' });
    }
    setStoryBusy(false);
  }

  async function handleClearStory() {
    setStoryBusy(true);
    setStoryMsg(null);
    try {
      await clearStory(getDb());
      setStory(null);
      setStoryMsg({ kind: 'ok', text: 'Story removed.' });
      void revalidateHomepage();
    } catch (e) {
      setStoryMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not clear.' });
    }
    setStoryBusy(false);
  }

  function tokenDaysLeft(): number | null {
    if (!igStatus?.expiresAt) return null;
    return Math.ceil((new Date(igStatus.expiresAt).getTime() - Date.now()) / 86_400_000);
  }

  const daysLeft = tokenDaysLeft();
  const tokenWarning = daysLeft !== null && daysLeft < 14;

  return (
    <main className="admin-main">
      <h1 className="page-title">From the street</h1>
      <p className="page-dek">
        Instagram tiles on the homepage - terrace shots, pours, anything that shows the vibe.
      </p>

      {/* ── Current story ────────────────────────────────────────────────── */}
      <section className="card mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.78rem] font-medium uppercase tracking-[0.08em]">Current story</p>
            {story === undefined ? (
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">Loading…</p>
            ) : story ? (
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">
                {story.account} · live until{' '}
                {new Date(story.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            ) : (
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">
                No active story - appears as the first tile with a gradient ring.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setShowStoryForm((v) => !v); setStoryMsg(null); }}
              className="btn btn-primary min-h-11"
            >
              {story ? 'Replace story' : 'Post story'}
            </button>
            {story && (
              <button onClick={handleClearStory} disabled={storyBusy} className="btn btn-quiet min-h-11">
                Remove
              </button>
            )}
          </div>
        </div>

        {storyMsg && (
          <p className={`mt-3 text-[var(--fs-body)] ${storyMsg.kind === 'ok' ? 'text-[var(--text-muted)]' : 'text-[var(--danger)]'}`}>
            {storyMsg.text}
          </p>
        )}

        {story && !showStoryForm && (
          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-sm"
              style={{
                padding: '2px',
                background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
              }}
            >
              <img src={story.imageUrl} alt="" className="h-full w-full rounded-sm object-cover" />
            </div>
            <p className="text-[var(--fs-label)] text-[var(--text-muted)] truncate">{story.href || '(no link set)'}</p>
          </div>
        )}

        {showStoryForm && (
          <form onSubmit={saveStory} className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn btn-quiet min-h-11 cursor-pointer">
                {storyUploading ? 'Uploading…' : storyDraft.imageUrl ? 'Replace image' : 'Upload story image'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { void pickStoryImage(e.target.files?.[0] ?? null); e.target.value = ''; }}
                  disabled={storyUploading}
                  className="hidden"
                />
              </label>
              {storyDraft.imageUrl && (
                <div
                  className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-sm"
                  style={{
                    padding: '2px',
                    background: 'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                  }}
                >
                  <img src={storyDraft.imageUrl} alt="" className="h-full w-full rounded-sm object-cover" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={storyDraft.account}
                onChange={(e) => setStoryDraft((d) => ({ ...d, account: e.target.value }))}
                className="field min-h-11 w-auto"
                aria-label="Account"
              >
                <option value="@tannin_antwerp">@tannin_antwerp</option>
                <option value="@cellar_antwerp">@cellar_antwerp</option>
              </select>
              <input
                value={storyDraft.href}
                onChange={(e) => setStoryDraft((d) => ({ ...d, href: e.target.value }))}
                placeholder="instagram.com/p/… - paste a post link to fetch its image"
                aria-label="Story link"
                className="field min-h-11 flex-1"
              />
              <button
                type="button"
                onClick={() => fetchFromUrl(storyDraft.href, 'story')}
                disabled={fetching || !storyDraft.href.trim()}
                className="btn btn-quiet min-h-11"
              >
                {fetching ? 'Fetching…' : 'Fetch image'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={storyBusy || !storyDraft.imageUrl} className="btn btn-primary min-h-11">
                {storyBusy ? 'Publishing…' : 'Publish story'}
              </button>
              <button type="button" onClick={() => setShowStoryForm(false)} className="btn btn-quiet min-h-11">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ── Instagram connection ──────────────────────────────────────────── */}
      <section className="card mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.78rem] font-medium uppercase tracking-[0.08em]">Instagram sync</p>
            {igStatus === null ? (
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">Loading…</p>
            ) : igStatus.connected ? (
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">
                {igStatus.handle}
                {igStatus.lastSynced && (
                  <> · last synced {new Date(igStatus.lastSynced).toLocaleDateString()}</>
                )}
                {daysLeft !== null && (
                  <span className={tokenWarning ? ' text-[var(--danger)]' : ''}>
                    {' '}· token expires in {daysLeft}d
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">
                Not connected - posts are managed manually below.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {igStatus?.connected ? (
              <>
                <button
                  onClick={handleSync}
                  disabled={igBusy}
                  className="btn btn-primary min-h-11"
                >
                  {igBusy ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={() => setShowConnect((v) => !v)}
                  className="btn btn-quiet min-h-11"
                >
                  Reconnect
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={igBusy}
                  className="btn btn-quiet min-h-11"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowConnect((v) => !v)}
                className="btn btn-primary min-h-11"
              >
                Connect Instagram
              </button>
            )}
          </div>
        </div>

        {igMsg && (
          <p
            className={`mt-3 text-[var(--fs-body)] ${igMsg.kind === 'ok' ? 'text-[var(--text-muted)]' : 'text-[var(--danger)]'}`}
          >
            {igMsg.text}
          </p>
        )}

        {showConnect && (
          <form onSubmit={handleConnect} className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
            <p className="text-[var(--fs-label)] text-[var(--text-muted)] leading-relaxed">
              Paste an access token from{' '}
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Graph API Explorer
              </a>
              . The token needs the <strong>instagram_basic</strong> permission (add{' '}
              <strong>pages_show_list</strong> too if your account is a Business account). The admin
              exchanges it for a 60-day token automatically if{' '}
              <code>INSTAGRAM_APP_ID</code> / <code>APP_SECRET</code> are set.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                value={igHandle}
                onChange={(e) => setIgHandle(e.target.value)}
                className="field min-h-11 w-auto"
                aria-label="Account"
              >
                <option value="@tannin_antwerp">@tannin_antwerp</option>
                <option value="@cellar_antwerp">@cellar_antwerp</option>
              </select>
              <input
                value={igToken}
                onChange={(e) => setIgToken(e.target.value)}
                placeholder="Paste access token…"
                aria-label="Access token"
                className="field min-h-11 flex-1 font-mono text-[0.72rem]"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={igBusy || !igToken.trim()} className="btn btn-primary min-h-11">
                {igBusy ? 'Connecting…' : 'Connect'}
              </button>
              <button type="button" onClick={() => { setShowConnect(false); setIgMsg(null); }} className="btn btn-quiet min-h-11">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}

      {/* ── Manual editor ────────────────────────────────────────────────── */}
      <div className="mt-6">
        {editing ? (
          <div className="card p-4">
            <div className="flex flex-col gap-3">
              {/* Image */}
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

              {/* Label + caption */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  aria-label="Account"
                  className="field min-h-11 w-auto"
                >
                  <option value="@tannin_antwerp">@tannin_antwerp</option>
                  <option value="@cellar_antwerp">@cellar_antwerp</option>
                </select>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Caption - Terrace days"
                  aria-label="Caption"
                  className="field min-h-11 flex-1"
                  autoFocus
                />
              </div>

              {/* Instagram link + fetch + published toggle */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={draft.href}
                  onChange={(e) => setDraft({ ...draft, href: e.target.value })}
                  placeholder="instagram.com/p/… - paste link, then Fetch image"
                  aria-label="Instagram post URL"
                  className="field min-h-11 flex-1"
                />
                <button
                  type="button"
                  onClick={() => fetchFromUrl(draft.href, 'post')}
                  disabled={fetching || !draft.href.trim()}
                  className="btn btn-quiet min-h-11"
                >
                  {fetching ? 'Fetching…' : 'Fetch image'}
                </button>
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
                  {busy ? 'Saving…' : editing === 'new' ? 'Add post' : 'Save'}
                </button>
                <button onClick={() => setEditing(null)} className="btn btn-quiet min-h-11">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={openNew} className="btn btn-primary min-h-11">
            + New post
          </button>
        )}
      </div>

      {rows === null ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">One moment…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">No posts yet.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((post, i) => (
            <li key={post.id} className="card flex flex-wrap items-center gap-3 p-3">
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
              {post.imageUrl && (
                <img
                  src={post.imageUrl}
                  alt=""
                  className="h-12 w-12 rounded object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9rem] font-medium">
                  {post.title}
                  {!post.published && (
                    <span className="ml-2 text-[var(--fs-label)] text-[var(--text-muted)]">draft</span>
                  )}
                  {post.instagramId && (
                    <span className="ml-2 text-[var(--fs-label)] text-[var(--text-muted)]">IG</span>
                  )}
                </p>
                <p className="text-[var(--fs-label)] text-[var(--text-muted)]">{post.label}</p>
              </div>
              <button onClick={() => openEdit(post)} className="btn btn-quiet min-h-11">
                Edit
              </button>
              <button onClick={() => remove(post.id)} className="btn btn-quiet min-h-11">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
