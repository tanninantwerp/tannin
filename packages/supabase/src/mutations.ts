import type { SupabaseClient } from '@supabase/supabase-js';
import type { DrinkCategory, MenuSectionId } from '@tannin/core';
import type { EventKind } from './queries';

/**
 * Writes for the admin.
 *
 * Kept apart from `queries.ts` because these all require a signed-in staff
 * member: the row-level security in the migrations rejects them outright with
 * the anon key. Nothing here is reachable from the public site.
 */

// ── the bar list ─────────────────────────────────────────────────────────────
// This is the one that matters day to day. The bar list changes weekly, and
// until Tawat can edit it here the hosted menu subscription cannot be dropped.

export interface DrinkInput {
  sectionId: DrinkCategory;
  name: string;
  note?: string;
  price: number;
  soldOut?: boolean;
}

export interface DrinkRow extends DrinkInput {
  id: string;
  position: number;
  updatedAt: string;
}

export async function createDrink(db: SupabaseClient, input: DrinkInput): Promise<string> {
  // New pours land at the bottom of their section.
  const { data: last } = await db
    .from('drinks')
    .select('position')
    .eq('section_id', input.sectionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await db
    .from('drinks')
    .insert({
      section_id: input.sectionId,
      name: input.name,
      note: input.note ?? null,
      price: input.price,
      sold_out: input.soldOut ?? false,
      position: (last?.position ?? -1) + 1,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function updateDrink(
  db: SupabaseClient,
  id: string,
  patch: Partial<DrinkInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.sectionId !== undefined) row.section_id = patch.sectionId;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.note !== undefined) row.note = patch.note || null;
  if (patch.price !== undefined) row.price = patch.price;
  if (patch.soldOut !== undefined) row.sold_out = patch.soldOut;

  if (Object.keys(row).length === 0) return;

  const { error } = await db.from('drinks').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteDrink(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('drinks').delete().eq('id', id);
  if (error) throw error;
}

/**
 * The single most-used control in the room: a bottle runs out mid-service and
 * someone marks it from their phone. Kept as its own call so the UI can fire it
 * from a toggle without assembling a patch.
 */
export async function setDrinkSoldOut(
  db: SupabaseClient,
  id: string,
  soldOut: boolean,
): Promise<void> {
  const { error } = await db.from('drinks').update({ sold_out: soldOut }).eq('id', id);
  if (error) throw error;
}

/**
 * Persists a reordered section.
 *
 * Takes the ids in their new order and writes positions to match, rather than
 * asking the caller to compute indices - dragging is the natural gesture here
 * and the UI should not have to think about it.
 */
export async function reorderDrinks(db: SupabaseClient, orderedIds: readonly string[]): Promise<void> {
  const updates = orderedIds.map((id, position) =>
    db.from('drinks').update({ position }).eq('id', id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ── food menu ────────────────────────────────────────────────────────────────

export interface MenuItemInput {
  sectionId: MenuSectionId;
  name: string;
  note?: string;
  price: number;
  /** Middle tier for a three-price dish, e.g. Ibérico cold cuts 11/16/19. */
  priceMid?: number;
  /** Set only for ranged prices, e.g. Ibérico cold cuts 11/19. */
  priceMax?: number;
  withCrackers?: boolean;
  soldOut?: boolean;
}

export async function createMenuItem(db: SupabaseClient, input: MenuItemInput): Promise<string> {
  const { data: last } = await db
    .from('menu_items')
    .select('position')
    .eq('section_id', input.sectionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row: Record<string, unknown> = {
    section_id: input.sectionId,
    name: input.name,
    note: input.note ?? null,
    price: input.price,
    price_max: input.priceMax ?? null,
    with_crackers: input.withCrackers ?? false,
    sold_out: input.soldOut ?? false,
    position: (last?.position ?? -1) + 1,
  };
  // Only touch price_mid when it is actually set, so this keeps working before
  // the price_mid column's migration has run.
  if (input.priceMid !== undefined) row.price_mid = input.priceMid || null;

  const { data, error } = await db.from('menu_items').insert(row).select('id').single();

  if (error) throw error;
  return data.id;
}

export async function updateMenuItem(
  db: SupabaseClient,
  id: string,
  patch: Partial<MenuItemInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.sectionId !== undefined) row.section_id = patch.sectionId;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.note !== undefined) row.note = patch.note || null;
  if (patch.price !== undefined) row.price = patch.price;
  if (patch.priceMid !== undefined) row.price_mid = patch.priceMid || null;
  if (patch.priceMax !== undefined) row.price_max = patch.priceMax || null;
  if (patch.withCrackers !== undefined) row.with_crackers = patch.withCrackers;
  if (patch.soldOut !== undefined) row.sold_out = patch.soldOut;

  if (Object.keys(row).length === 0) return;

  const { error } = await db.from('menu_items').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteMenuItem(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('menu_items').delete().eq('id', id);
  if (error) throw error;
}

export async function reorderMenuItems(
  db: SupabaseClient,
  orderedIds: readonly string[],
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, position) => db.from('menu_items').update({ position }).eq('id', id)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ── wines ────────────────────────────────────────────────────────────────────

export async function setWineAvailable(
  db: SupabaseClient,
  id: string,
  available: boolean,
): Promise<void> {
  const { error } = await db.from('wines').update({ available }).eq('id', id);
  if (error) throw error;
}

export async function setWineStaffPick(
  db: SupabaseClient,
  id: string,
  staffPick: boolean,
): Promise<void> {
  const { error } = await db.from('wines').update({ staff_pick: staffPick }).eq('id', id);
  if (error) throw error;
}

// ── access ───────────────────────────────────────────────────────────────────

/** Whether the signed-in user may use the admin at all. */
export async function isStaff(db: SupabaseClient): Promise<boolean> {
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return false;

  const { data, error } = await db
    .from('staff')
    .select('user_id')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // A failure here means not permitted, not "assume yes".
  if (error) return false;
  return Boolean(data);
}

// ── events ───────────────────────────────────────────────────────────────────
// What's-on, behind the `marketing` permission. RLS rejects these for anyone
// without it, whatever the admin renders.

export interface EventInput {
  slug: string;
  title: string;
  kind: EventKind;
  startsOn?: string | null;
  endsOn?: string | null;
  location?: string | null;
  summary?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  sourceAccount?: 'tannin' | 'cellar' | null;
  published?: boolean;
}

/** Turn the camelCase input into the row shape, dropping empty strings to null. */
function eventRow(input: Partial<EventInput>): Record<string, unknown> {
  const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const row: Record<string, unknown> = {};
  if (input.slug !== undefined) row.slug = input.slug.trim();
  if (input.title !== undefined) row.title = input.title.trim();
  if (input.kind !== undefined) row.kind = input.kind;
  if (input.startsOn !== undefined) row.starts_on = nn(input.startsOn);
  if (input.endsOn !== undefined) row.ends_on = nn(input.endsOn);
  if (input.location !== undefined) row.location = nn(input.location);
  if (input.summary !== undefined) row.summary = nn(input.summary);
  if (input.body !== undefined) row.body = nn(input.body);
  if (input.imageUrl !== undefined) row.image_url = nn(input.imageUrl);
  if (input.sourceUrl !== undefined) row.source_url = nn(input.sourceUrl);
  if (input.sourceAccount !== undefined) row.source_account = input.sourceAccount || null;
  if (input.published !== undefined) row.published = input.published;
  return row;
}

/** New event, placed at the top of the list. Returns its id. */
export async function createEvent(db: SupabaseClient, input: EventInput): Promise<string> {
  // Position before the current lowest so it sorts first.
  const { data: first } = await db
    .from('events')
    .select('position')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  const position = ((first?.position as number | undefined) ?? 0) - 1;

  const { data, error } = await db
    .from('events')
    .insert({ ...eventRow(input), position })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateEvent(
  db: SupabaseClient,
  id: string,
  patch: Partial<EventInput>,
): Promise<void> {
  const { error } = await db.from('events').update(eventRow(patch)).eq('id', id);
  if (error) throw error;
}

export async function deleteEvent(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('events').delete().eq('id', id);
  if (error) throw error;
}

/** Write the running order back, position by position - mirrors reorderDrinks. */
export async function reorderEvents(db: SupabaseClient, orderedIds: readonly string[]): Promise<void> {
  const updates = orderedIds.map((id, position) =>
    db.from('events').update({ position }).eq('id', id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ── image uploads ────────────────────────────────────────────────────────────
// The `media` bucket is public-read; only `marketing` writes. See 0043.

/**
 * Upload a picked file under `<folder>/<uuid>.<ext>` and return its public URL.
 *
 * Random filename avoids collisions and hides the original name (which staff
 * often forget is client data). Extension is preserved so browsers pick the
 * right content-type when the URL is opened directly.
 */
export async function uploadMediaFile(
  db: SupabaseClient,
  file: File,
  folder: 'events' | 'menu' | 'wine' | 'social' | 'pages',
): Promise<string> {
  const ext = /\.[a-z0-9]+$/i.exec(file.name)?.[0]?.toLowerCase() ?? '';
  const path = `${folder}/${crypto.randomUUID()}${ext}`;
  const { error } = await db.storage.from('media').upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return db.storage.from('media').getPublicUrl(path).data.publicUrl;
}

// ── social posts ──────────────────────────────────────────────────────────────

export interface SocialPostInput {
  imageUrl: string;
  label: string;
  title: string;
  href: string;
  published: boolean;
}

/** New social post, placed at the top of the list. Returns its id. */
export async function createSocialPost(
  db: SupabaseClient,
  input: SocialPostInput,
): Promise<string> {
  const { data: first } = await db
    .from('social_posts')
    .select('position')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  const position = ((first?.position as number | undefined) ?? 0) - 1;

  const { data, error } = await db
    .from('social_posts')
    .insert({
      image_url: input.imageUrl,
      label: input.label,
      title: input.title,
      href: input.href,
      published: input.published,
      position,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateSocialPost(
  db: SupabaseClient,
  id: string,
  patch: Partial<SocialPostInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.href !== undefined) row.href = patch.href;
  if (patch.published !== undefined) row.published = patch.published;
  if (Object.keys(row).length === 0) return;
  const { error } = await db.from('social_posts').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteSocialPost(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('social_posts').delete().eq('id', id);
  if (error) throw error;
}

/** Write the running order back - mirrors reorderEvents. */
export async function reorderSocialPosts(
  db: SupabaseClient,
  orderedIds: readonly string[],
): Promise<void> {
  const updates = orderedIds.map((id, position) =>
    db.from('social_posts').update({ position }).eq('id', id),
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ── app settings ─────────────────────────────────────────────────────────────

/** Upsert one or more app_settings rows by key. */
export async function saveAppSettings(
  db: SupabaseClient,
  settings: Record<string, string>,
): Promise<void> {
  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
}

/** Delete an app_settings row - used to disconnect Instagram. */
export async function deleteAppSetting(db: SupabaseClient, key: string): Promise<void> {
  await db.from('app_settings').delete().eq('key', key);
}

// ── current story ─────────────────────────────────────────────────────────────

export interface StoryInput {
  imageUrl: string;
  href: string;
  account: string;
  /** Hours the story is live before auto-hiding. Defaults to 24. */
  hoursLive?: number;
}

/** Publish or replace the current story. It auto-hides after hoursLive hours. */
export async function publishStory(db: SupabaseClient, input: StoryInput): Promise<void> {
  const hours = input.hoursLive ?? 24;
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  await saveAppSettings(db, {
    story_image_url: input.imageUrl,
    story_href: input.href,
    story_account: input.account,
    story_expires_at: expiresAt,
  });
}

/** Remove the current story immediately. */
export async function clearStory(db: SupabaseClient): Promise<void> {
  await Promise.all(
    ['story_image_url', 'story_href', 'story_account', 'story_expires_at'].map((k) =>
      db.from('app_settings').delete().eq('key', k),
    ),
  );
}
