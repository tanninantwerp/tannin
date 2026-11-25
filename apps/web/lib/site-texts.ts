import { unstable_cache } from 'next/cache';
import { fetchSiteTexts, type L10nText } from '@tannin/supabase';
import { serverDb } from '@/lib/server-db';

/** Tag the admin's "publish" call drops, so an edit shows on the next visit. */
export const CONTENT_TAG = 'site-content';

/**
 * The text edits made in Admin > Texts.
 *
 * Cached for a minute like the opening hours, so the pages stay
 * static-with-ISR. If the read fails the site shows the wording in the code
 * rather than failing to render.
 */
export const siteTextEdits = unstable_cache(
  async (): Promise<Record<string, L10nText>> => {
    try {
      return await fetchSiteTexts(serverDb());
    } catch {
      return {};
    }
  },
  ['site-texts'],
  { revalidate: 60, tags: [CONTENT_TAG] },
);
