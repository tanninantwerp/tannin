'use server';

import { createClient } from '@supabase/supabase-js';
import { saveAppSettings, deleteAppSetting } from '@tannin/supabase';
import {
  discoverInstagramAccount,
  exchangeFbToken,
  syncInstagramPosts,
} from '@/lib/instagram';
import { SUPABASE_SERVICE_KEY } from '@/lib/supabase-keys';

function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } },
  );
}

export interface ConnectResult {
  ok: boolean;
  username?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * Connect an Instagram account.
 *
 * The user pastes a token from the Facebook Graph API Explorer (or the
 * Instagram token tool). We discover which IG account it accesses, exchange
 * it for a 60-day long-lived token if INSTAGRAM_APP_ID/APP_SECRET are set,
 * and save everything to app_settings.
 */
export async function connectInstagram(
  token: string,
  handle: string,
): Promise<ConnectResult> {
  if (!token.trim()) return { ok: false, error: 'Paste an access token first.' };

  try {
    const db = adminDb();

    // Discover which Instagram account the token accesses.
    const account = await discoverInstagramAccount(token);

    // Try to exchange for a long-lived token (needs INSTAGRAM_APP_ID + APP_SECRET).
    let finalToken = token;
    let expiresAt: string | undefined;
    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (appId && appSecret) {
      const exchanged = await exchangeFbToken(token, appId, appSecret);
      finalToken = exchanged.accessToken;
      expiresAt = exchanged.expiresAt;
    }

    await saveAppSettings(db, {
      instagram_access_token: finalToken,
      instagram_user_id: account.userId,
      instagram_api_base: account.apiBase,
      instagram_account_handle: handle,
      ...(expiresAt ? { instagram_token_expires_at: expiresAt } : {}),
    });

    return { ok: true, username: account.username, expiresAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Connection failed.' };
  }
}

export interface SyncResult {
  ok: boolean;
  synced?: number;
  error?: string;
}

/** Trigger an Instagram sync from the admin UI. */
export async function triggerInstagramSync(): Promise<SyncResult> {
  try {
    const synced = await syncInstagramPosts(adminDb());
    return { ok: true, synced };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sync failed.' };
  }
}

export interface FetchPostResult {
  ok: boolean;
  imageUrl?: string;
  title?: string;
  label?: string;
  error?: string;
}

/**
 * Given an Instagram post URL, fetch the image via oEmbed, download it, and
 * store it in the media bucket. Returns the permanent Supabase URL plus the
 * post caption and author handle - callers use these to pre-fill the form.
 *
 * Works for any public post on any account. No special permissions needed
 * beyond the instagram_basic token already stored in app_settings.
 */
export async function fetchPostImage(postUrl: string): Promise<FetchPostResult> {
  const db = adminDb();

  const settings = await (await import('@tannin/supabase')).fetchAppSettings(db, [
    'instagram_access_token',
  ]);
  const token = settings.instagram_access_token;
  if (!token) {
    return { ok: false, error: 'Connect an Instagram account first - the token is needed to fetch post images.' };
  }

  // oEmbed returns thumbnail_url, title (caption), author_name without extra scopes.
  const oembedUrl = `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(postUrl)}&fields=thumbnail_url,title,author_name&access_token=${encodeURIComponent(token)}`;
  const oembedRes = await fetch(oembedUrl);
  if (!oembedRes.ok) {
    const err = (await oembedRes.json()) as { error?: { message: string } };
    return { ok: false, error: err?.error?.message ?? `oEmbed request failed (${oembedRes.status})` };
  }
  const oembed = (await oembedRes.json()) as {
    thumbnail_url?: string;
    title?: string;
    author_name?: string;
  };

  const imageSource = oembed.thumbnail_url;
  if (!imageSource) {
    return { ok: false, error: 'Instagram did not return an image for this post. It may be a video without a thumbnail or a private post.' };
  }

  // Download and upload to our bucket so the URL never expires.
  const imgRes = await fetch(imageSource);
  if (!imgRes.ok) return { ok: false, error: 'Could not download the image from Instagram.' };

  const buf = Buffer.from(await imgRes.arrayBuffer());
  // Derive a stable storage path from the post shortcode.
  const shortcode = postUrl.match(/\/p\/([^/?]+)/)?.[1] ?? `manual-${Date.now()}`;
  const path = `social/${shortcode}.jpg`;

  const { error: upErr } = await db.storage.from('media').upload(path, buf, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) return { ok: false, error: upErr.message };

  const imageUrl = db.storage.from('media').getPublicUrl(path).data.publicUrl;

  // Title: first line of caption, hashtags stripped, max 100 chars.
  const rawCaption = oembed.title ?? '';
  const title = rawCaption.split('\n')[0].replace(/#\w+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || undefined;

  // Label: match author_name to our account options.
  const author = oembed.author_name ?? '';
  const label = author.includes('cellar') ? '@cellar_antwerp' : '@tannin_antwerp';

  return { ok: true, imageUrl, title, label };
}

/**
 * Tell the web app to drop its ISR cache for the homepage so social post
 * changes appear immediately instead of waiting up to an hour.
 *
 * Set REVALIDATE_SECRET on both Vercel projects to the same random string.
 * If the env var is missing the request still fires - the route accepts it.
 */
export async function revalidateHomepage(): Promise<void> {
  const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'https://ta-nnin.be';
  const secret = process.env.REVALIDATE_SECRET;
  await fetch(`${webUrl}/api/revalidate`, {
    method: 'POST',
    headers: secret ? { 'x-revalidate-secret': secret } : {},
  }).catch(() => {});
}

/** Remove all Instagram connection settings - reverts to manual-only mode. */
export async function disconnectInstagram(): Promise<void> {
  const db = adminDb();
  const keys = [
    'instagram_access_token',
    'instagram_token_expires_at',
    'instagram_user_id',
    'instagram_api_base',
    'instagram_account_handle',
    'instagram_last_synced_at',
  ];
  await Promise.all(keys.map((k) => deleteAppSetting(db, k)));
}
