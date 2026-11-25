/**
 * Instagram Graph API sync helpers.
 *
 * Supports two account types:
 *  - Business/Creator via Facebook Graph API (graph.facebook.com)
 *    Token obtained through Facebook Login with instagram_basic scope.
 *  - Instagram API with Instagram Login (graph.instagram.com)
 *    The new replacement for the deprecated Basic Display API (Dec 2024).
 *
 * During Connect we auto-detect which applies by trying both.
 * After connecting, the resolved API base and IG user ID are stored in
 * app_settings so every subsequent sync knows exactly which endpoint to call.
 *
 * Token refresh:
 *  - graph.facebook.com tokens: exchange via fb_exchange_token grant.
 *    Requires INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET env vars.
 *  - graph.instagram.com tokens: refresh via ig_refresh_token grant.
 *    No app credentials needed, but the token must not already be expired.
 *
 * Images are downloaded from Instagram's CDN and re-uploaded to our own
 * Supabase media bucket so URLs never expire, regardless of token state.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAppSettings, saveAppSettings } from '@tannin/supabase';

const FB_API = 'https://graph.facebook.com/v21.0';
const IG_API = 'https://graph.instagram.com/v21.0';
const MEDIA_FIELDS = 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp';

interface IgMedia {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  caption?: string;
  timestamp: string;
}

export interface InstagramConnection {
  userId: string;
  username: string;
  apiBase: string;
}

// ── Token exchange / refresh ──────────────────────────────────────────────────

/** Exchange any token for a long-lived one (60 days) using Facebook OAuth. */
export async function exchangeFbToken(
  token: string,
  appId: string,
  appSecret: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const url = `${FB_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  const expiresIn = data.expires_in ?? 60 * 24 * 3600;
  return {
    accessToken: data.access_token!,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/** Refresh an instagram.com long-lived token (no app credentials needed). */
async function refreshIgToken(
  token: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const url = `${IG_API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  const expiresIn = data.expires_in ?? 60 * 24 * 3600;
  return {
    accessToken: data.access_token!,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

// ── Account discovery ─────────────────────────────────────────────────────────

/**
 * Given an access token, discover the Instagram account(s) it can access.
 *
 * Tries the new Instagram API first (graph.instagram.com, Creator accounts and
 * the replacement for Basic Display API), then falls back to the Facebook Graph
 * API path (Business accounts connected to a Facebook Page).
 *
 * Returns the first/only account found. If multiple Business IG accounts are
 * connected (rare), returns the first - staff can disconnect and reconnect to
 * pick a different one.
 */
export async function discoverInstagramAccount(token: string): Promise<InstagramConnection> {
  // Try Instagram API (new path for Creator accounts)
  const igRes = await fetch(`${IG_API}/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
  if (igRes.ok) {
    const d = (await igRes.json()) as { id: string; username: string };
    if (d.id) return { userId: d.id, username: d.username, apiBase: IG_API };
  }

  // Fall back to Facebook Graph API (Business account path)
  const fbRes = await fetch(
    `${FB_API}/me/accounts?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`,
  );
  if (!fbRes.ok) {
    throw new Error(
      'Could not verify this token. Make sure it has the instagram_basic (or pages_show_list + instagram_basic) permission.',
    );
  }
  const fbData = (await fbRes.json()) as {
    data: Array<{ instagram_business_account?: { id: string; username: string } }>;
    error?: { message: string };
  };
  if (fbData.error) throw new Error(fbData.error.message);

  const igAccounts = (fbData.data ?? [])
    .map((p) => p.instagram_business_account)
    .filter((a): a is { id: string; username: string } => Boolean(a?.id));

  if (igAccounts.length === 0) {
    throw new Error(
      'No Instagram Business account linked to this Facebook token. ' +
        'Make sure your Instagram account is a Business or Creator account connected to a Facebook Page.',
    );
  }

  const { id, username } = igAccounts[0];
  return { userId: id, username, apiBase: FB_API };
}

// ── Main sync ─────────────────────────────────────────────────────────────────

function extractTitle(caption?: string): string {
  if (!caption) return 'From the street';
  // First non-empty line, hashtags stripped, truncated.
  const firstLine = caption.split('\n').find((l) => l.trim().length > 0) ?? caption;
  const clean = firstLine.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 100) || 'From the street';
}

/**
 * Pull recent Instagram posts into social_posts.
 *
 * - New posts: image downloaded → Supabase media bucket → row inserted (published).
 * - Existing posts (matched by instagram_id): title + href refreshed, image kept.
 * - Manual posts (instagram_id IS NULL): never touched.
 * - Posts staff have set to published=false: kept unpublished on re-sync.
 *
 * Returns the number of rows created or refreshed.
 */
export async function syncInstagramPosts(db: SupabaseClient): Promise<number> {
  const settings = await fetchAppSettings(db, [
    'instagram_access_token',
    'instagram_token_expires_at',
    'instagram_user_id',
    'instagram_api_base',
    'instagram_account_handle',
  ]);

  const token = settings.instagram_access_token;
  if (!token) throw new Error('No Instagram account connected. Use the Connect button in the Social admin.');

  const userId = settings.instagram_user_id;
  const apiBase = settings.instagram_api_base ?? FB_API;
  const handle = settings.instagram_account_handle ?? '@tannin_antwerp';

  // Auto-refresh if expiring within 30 days.
  let liveToken = token;
  const expiresAt = settings.instagram_token_expires_at;
  if (expiresAt) {
    const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    if (daysLeft < 30) {
      try {
        const appId = process.env.INSTAGRAM_APP_ID;
        const appSecret = process.env.INSTAGRAM_APP_SECRET;
        const refreshed =
          appId && appSecret
            ? await exchangeFbToken(token, appId, appSecret)
            : await refreshIgToken(token);
        liveToken = refreshed.accessToken;
        await saveAppSettings(db, {
          instagram_access_token: refreshed.accessToken,
          instagram_token_expires_at: refreshed.expiresAt,
        });
      } catch {
        // Non-fatal: sync proceeds with the existing token.
      }
    }
  }

  // Fetch up to 20 recent posts.
  const mediaEndpoint = userId
    ? `${apiBase}/${userId}/media?fields=${MEDIA_FIELDS}&limit=20&access_token=${encodeURIComponent(liveToken)}`
    : `${apiBase}/me/media?fields=${MEDIA_FIELDS}&limit=20&access_token=${encodeURIComponent(liveToken)}`;

  const mediaRes = await fetch(mediaEndpoint);
  if (!mediaRes.ok) {
    const err = (await mediaRes.json()) as { error?: { message: string } };
    throw new Error(err?.error?.message ?? `Instagram API returned ${mediaRes.status}`);
  }
  const { data: posts = [] } = (await mediaRes.json()) as { data?: IgMedia[] };

  // Keep images (and Reels that have a thumbnail, i.e. a still frame).
  const imagePosts = posts.filter(
    (p) => p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM' || (p.media_type === 'VIDEO' && p.thumbnail_url),
  );

  // Which instagram_ids already exist in the DB?
  const { data: existing } = await db
    .from('social_posts')
    .select('id,instagram_id,image_url')
    .not('instagram_id', 'is', null);
  const existingMap = new Map(
    (existing ?? []).map((r: { id: string; instagram_id: string; image_url: string }) => [
      r.instagram_id,
      r,
    ]),
  );

  // Pre-compute positions for any new posts (place them above existing content).
  const newPosts = imagePosts.filter((p) => !existingMap.has(p.id));
  let basePosition = 0;
  if (newPosts.length > 0) {
    const { data: first } = await db
      .from('social_posts')
      .select('position')
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    basePosition = ((first?.position as number | undefined) ?? 0);
  }

  let synced = 0;

  // Process existing posts first (cheap: just update text fields).
  for (const post of imagePosts.filter((p) => existingMap.has(p.id))) {
    const row = existingMap.get(post.id)!;
    await db
      .from('social_posts')
      .update({ title: extractTitle(post.caption), href: post.permalink })
      .eq('id', row.id);
    synced++;
  }

  // Insert new posts - newest last in the imagePosts array (Instagram returns newest first),
  // so we assign decreasing positions so newest post sits highest (lowest position number).
  for (let i = 0; i < newPosts.length; i++) {
    const post = newPosts[i];
    const imageSource = post.thumbnail_url ?? post.media_url ?? '';
    const position = basePosition - (newPosts.length - i);

    // Download the image and store it in our media bucket so the URL is permanent.
    let finalImageUrl = imageSource;
    if (imageSource) {
      try {
        const imgRes = await fetch(imageSource);
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const path = `social/${post.id}.jpg`;
          const { error: upErr } = await db.storage.from('media').upload(path, buf, {
            contentType: 'image/jpeg',
            upsert: true,
          });
          if (!upErr) {
            finalImageUrl = db.storage.from('media').getPublicUrl(path).data.publicUrl;
          }
        }
      } catch {
        // Fall back to the Instagram URL; it may expire but the next sync will fix it.
      }
    }

    const { error } = await db.from('social_posts').insert({
      instagram_id: post.id,
      image_url: finalImageUrl,
      label: handle,
      title: extractTitle(post.caption),
      href: post.permalink,
      published: true,
      position,
    });
    if (!error) synced++;
  }

  await saveAppSettings(db, { instagram_last_synced_at: new Date().toISOString() });
  return synced;
}
