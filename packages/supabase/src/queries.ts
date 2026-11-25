import type { SupabaseClient } from '@supabase/supabase-js';
import { repairEncoding } from '@tannin/core';
import type {
  Blackout,
  Booking,
  BookingArea,
  BookingChange,
  BookingStatus,
  DayNote,
  DrinkCategory,
  DrinkSection,
  MenuSection,
  MenuSectionId,
  ServiceWindow,
  Wine,
} from '@tannin/core';

/**
 * Every read and write the product needs, in one place.
 *
 * Components never talk to PostgREST directly - they call these - so when the
 * schema moves there is exactly one file to change, and the web app and the
 * native apps move together.
 */

export async function fetchMenu(db: SupabaseClient): Promise<MenuSection[]> {
  // `menu_items (*)` rather than a fixed column list, so a newly-added column
  // (like price_mid) is picked up without this query 400-ing before its
  // migration has run.
  const { data, error } = await db
    .from('menu_sections')
    .select('id, title, service, position, menu_items (*)')
    .order('position')
    .order('position', { referencedTable: 'menu_items' });

  if (error) throw error;

  return (data ?? []).map((section) => ({
    id: section.id as MenuSectionId,
    title: section.title as string,
    service: section.service as MenuSection['service'],
    items: (section.menu_items ?? [])
      .filter((item: { sold_out: boolean }) => !item.sold_out)
      .map((item: Record<string, unknown>) => {
        // One, two or three tiers, in order - the Ibérico is 11 / 16 / 19.
        const tiers = [Number(item.price)];
        if (item.price_mid != null) tiers.push(Number(item.price_mid));
        if (item.price_max != null) tiers.push(Number(item.price_max));
        return {
          id: item.id as string,
          name: item.name as string,
          ...(item.note ? { note: item.note as string } : {}),
          price: tiers.length > 1 ? (tiers as readonly number[]) : Number(item.price),
          ...(item.with_crackers ? { withCrackers: true as const } : {}),
        };
      }),
  }));
}

/**
 * Every wine on the list, sold out or not - a sold-out bottle stays on the
 * page priced out, same as a sold-out pour on the bar list, rather than
 * vanishing. Only deleting the row in admin does that.
 */
export async function fetchWines(db: SupabaseClient): Promise<Wine[]> {
  const { data, error } = await db
    .from('wines')
    .select('*')
    .order('colour')
    .order('position');

  if (error) throw error;

  return (data ?? []).map((w) => ({
    id: w.id,
    // A handful of cellar rows were imported as UTF-8 and stored as
    // Windows-1252, which is why the list showed "Les Longeroies â€” Marsannay".
    // Repairing on read fixes every surface at once and survives a future
    // import going wrong again; see `repairEncoding`.
    name: repairEncoding(w.name),
    producer: repairEncoding(w.producer),
    colour: w.colour,
    country: repairEncoding(w.country),
    ...(w.region ? { region: repairEncoding(w.region) } : {}),
    ...(w.grapes?.length ? { grapes: w.grapes } : {}),
    ...(w.vintage ? { vintage: w.vintage } : {}),
    ...(w.glass ? { glass: Number(w.glass) } : {}),
    bottle: Number(w.bottle),
    ...(w.tasting_note ? { tastingNote: repairEncoding(w.tasting_note as string) } : {}),
    ...(w.in_shop ? { inShop: true } : {}),
    ...(w.staff_pick ? { staffPick: true } : {}),
    available: w.available,
  }));
}

/**
 * The bar list - everything poured by the glass, plus the rest of the bar.
 *
 * Unlike `fetchMenu`, a sold-out item is not dropped: the printed behaviour
 * this replaces is a strikethrough row that says "Sold out" where the price
 * was, not a gap on the page nobody can explain. The bottle a guest can see
 * their neighbour drinking should still be on the list, just marked gone.
 */
export async function fetchBarList(db: SupabaseClient): Promise<DrinkSection[]> {
  const { data, error } = await db
    .from('drink_sections')
    .select('id, title, is_wine, position, drinks (name, note, price, sold_out, position)')
    .order('position')
    .order('position', { referencedTable: 'drinks' });

  if (error) throw error;

  return (data ?? []).map((section) => ({
    id: section.id as DrinkCategory,
    title: section.title as string,
    ...(section.is_wine ? { isWine: true as const } : {}),
    items: (section.drinks ?? []).map((d: Record<string, unknown>) => ({
      name: d.name as string,
      ...(d.note ? { note: d.note as string } : {}),
      price: Number(d.price),
      ...(d.sold_out ? { soldOut: true as const } : {}),
    })),
  }));
}

/**
 * When the bar list last changed, for the "list updated" footnote.
 *
 * A separate query rather than folding into `fetchBarList`, because that one
 * already shapes rows for display and throws `updated_at` away - asking again
 * here is cheaper than carrying a timestamp through every item just for one
 * footer line.
 */
export async function fetchBarListUpdatedAt(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db
    .from('drinks')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.updated_at as string | undefined) ?? null;
}

/**
 * Closed days for the public date picker.
 *
 * Reads the view, not the table: guests get the dates, staff get the reasons.
 */
/** A weekday's hours as stored, including the closed flag the editor needs. */
export interface ServiceWindowRow extends ServiceWindow {
  closed: boolean;
}

function toWindowRow(r: Record<string, unknown>): ServiceWindowRow {
  return {
    weekday: r.weekday as number,
    opens: (r.opens as string).slice(0, 5),
    closes: (r.closes as string).slice(0, 5),
    lastSeating: (r.last_seating as string).slice(0, 5),
    closed: Boolean(r.closed),
  };
}

/**
 * The live opening hours as open windows only - the shape `availabilityFor`,
 * `windowFor`, the site's hours block, and the search-result schema all take.
 * A closed weekday is dropped, so those callers treat it exactly as they treat
 * a day the room never opens.
 */
export async function fetchServiceWindows(db: SupabaseClient): Promise<ServiceWindow[]> {
  const { data, error } = await db
    .from('service_windows')
    .select('weekday, opens, closes, last_seating, closed');
  if (error) throw error;
  return (data ?? [])
    .map(toWindowRow)
    .filter((w) => !w.closed)
    .map(({ closed: _closed, ...w }) => w);
}

/** All seven weekdays, closed ones included - for the admin hours editor. */
export async function fetchServiceWindowRows(db: SupabaseClient): Promise<ServiceWindowRow[]> {
  const { data, error } = await db
    .from('service_windows')
    .select('weekday, opens, closes, last_seating, closed')
    .order('weekday');
  if (error) throw error;
  return (data ?? []).map(toWindowRow);
}

/** Save one weekday's hours. */
export async function setServiceWindow(
  db: SupabaseClient,
  weekday: number,
  input: { opens: string; closes: string; lastSeating: string; closed: boolean },
): Promise<void> {
  const { error } = await db
    .from('service_windows')
    .update({
      opens: input.opens,
      closes: input.closes,
      last_seating: input.lastSeating,
      closed: input.closed,
    })
    .eq('weekday', weekday);
  if (error) throw error;
}

/**
 * A one-off opening-hours exception for a single date - closed all day, or open
 * for a different window than the usual weekday. Read publicly (it is shown on
 * the site), written by staff. Kept apart from `blackouts`, which are a booking
 * rule; this is only ever about what the hours block says.
 */
export interface HoursException {
  /** YYYY-MM-DD. */
  date: string;
  closed: boolean;
  /** HH:MM, or null when closed all day. */
  opens: string | null;
  closes: string | null;
  /** The public caption - "Christmas", "Private event". */
  note: string | null;
}

function toHoursException(r: Record<string, unknown>): HoursException {
  return {
    date: r.date as string,
    closed: Boolean(r.closed),
    opens: r.opens ? (r.opens as string).slice(0, 5) : null,
    closes: r.closes ? (r.closes as string).slice(0, 5) : null,
    note: (r.note as string | null) ?? null,
  };
}

/**
 * Opening-hours exceptions, soonest first. Pass `fromDate` to get only the ones
 * still to come - what the website shows.
 */
export async function fetchHoursExceptions(
  db: SupabaseClient,
  fromDate?: string,
): Promise<HoursException[]> {
  let query = db.from('hours_exceptions').select('date, closed, opens, closes, note').order('date');
  if (fromDate) query = query.gte('date', fromDate);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toHoursException);
}

/** Add or replace the exception for one date. */
export async function setHoursException(
  db: SupabaseClient,
  input: {
    date: string;
    closed: boolean;
    opens?: string | null;
    closes?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { error } = await db.from('hours_exceptions').upsert({
    date: input.date,
    closed: input.closed,
    // A closed day carries no times - clear them so a later reopen starts clean.
    opens: input.closed ? null : (input.opens ?? null),
    closes: input.closed ? null : (input.closes ?? null),
    note: input.note?.trim() ? input.note.trim() : null,
  });
  if (error) throw error;
}

/** Remove the exception for one date. */
export async function removeHoursException(db: SupabaseClient, date: string): Promise<void> {
  const { error } = await db.from('hours_exceptions').delete().eq('date', date);
  if (error) throw error;
}

/**
 * What's-on: café society nights, workshops, things with CE-LLAR. Public reads
 * the published ones; the admin (marketing permission) reads and writes all.
 */
export type EventKind = 'cafe-society' | 'workshop' | 'cellar' | 'other';

export interface EventItem {
  id: string;
  slug: string;
  title: string;
  kind: EventKind;
  /** YYYY-MM-DD, or null for an undated standing event. */
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  summary: string | null;
  body: string | null;
  imageUrl: string | null;
  /** The Instagram post this was curated from, if any. */
  sourceUrl: string | null;
  /** Which account it came from, so the card can read "Seen on @…". */
  sourceAccount: 'tannin' | 'cellar' | null;
  position: number;
  published: boolean;
}

function toEvent(r: Record<string, unknown>): EventItem {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    kind: (r.kind as EventKind) ?? 'other',
    startsOn: (r.starts_on as string | null) ?? null,
    endsOn: (r.ends_on as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    imageUrl: (r.image_url as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null,
    sourceAccount: (r.source_account as 'tannin' | 'cellar' | null) ?? null,
    position: (r.position as number) ?? 0,
    published: Boolean(r.published),
  };
}

// `select('*')` rather than a fixed column list so a newly added column (e.g.
// source_url/source_account, migration 0042) can't break these reads if the
// code deploys before the migration is applied - the row just lacks the field
// and toEvent reads it as null.

/** Published events for the public site, in the order staff arranged them. */
export async function fetchPublishedEvents(db: SupabaseClient): Promise<EventItem[]> {
  const { data, error } = await db
    .from('events')
    .select('*')
    .eq('published', true)
    .order('position');
  if (error) throw error;
  return (data ?? []).map(toEvent);
}

/** Every event, drafts included - for the admin editor. */
export async function fetchAllEvents(db: SupabaseClient): Promise<EventItem[]> {
  const { data, error } = await db.from('events').select('*').order('position');
  if (error) throw error;
  return (data ?? []).map(toEvent);
}

/** One published event by its slug, for its own page. */
export async function fetchEventBySlug(db: SupabaseClient, slug: string): Promise<EventItem | null> {
  const { data, error } = await db
    .from('events')
    .select('*')
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle();
  if (error) throw error;
  return data ? toEvent(data as Record<string, unknown>) : null;
}

export async function fetchPublicBlackouts(db: SupabaseClient): Promise<Blackout[]> {
  const { data, error } = await db.from('public_blackouts').select('date, from, to');
  if (error) throw error;

  return (data ?? []).map((b, i) => ({
    id: `public-${i}`,
    date: b.date as string,
    reason: '',
    ...(b.from ? { from: b.from as string } : {}),
    ...(b.to ? { to: b.to as string } : {}),
  }));
}

// ── staff only ───────────────────────────────────────────────────────────────

export interface CreateStaffBookingInput {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  /** Often unknown - a phone caller isn't always asked for one. */
  guestEmail?: string;
  guestPhone?: string;
  notes?: string;
  area?: BookingArea;
  locale?: 'en' | 'nl';
}

/**
 * Takes a phone reservation.
 *
 * The same `book_table` the public site calls - it allocates a table under the
 * same date lock and confirms outright when one fits, exactly as if the guest
 * had booked online themselves. The only difference staff get is that
 * `book_table` does not insist on an email from a caller it recognises as
 * staff (see migration 0018).
 */
export async function createStaffBooking(
  db: SupabaseClient,
  input: CreateStaffBookingInput,
): Promise<{ id: string; manageToken: string; status: BookingStatus }> {
  const { data, error } = await db.rpc('book_table', {
    on_date: input.date,
    at_time: input.time,
    party: input.partySize,
    in_name: input.guestName.trim(),
    in_email: input.guestEmail?.trim() || null,
    in_phone: input.guestPhone?.trim() || null,
    in_note: input.notes?.trim() || null,
    in_lang: input.locale ?? 'en',
    in_area: input.area ?? null,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Could not save that booking.');
  return { id: row.id, manageToken: row.manage_token, status: row.status };
}

// ── staff only ───────────────────────────────────────────────────────────────

export async function fetchBookings(db: SupabaseClient, date: string): Promise<Booking[]> {
  const { data, error } = await db
    .from('bookings')
    .select('*')
    .eq('date', date)
    .order('time');

  if (error) throw error;

  return (data ?? []).map((b) => ({
    id: b.id,
    date: b.date,
    time: b.time,
    partySize: b.party_size,
    guestName: b.guest_name,
    ...(b.guest_email ? { guestEmail: b.guest_email } : {}),
    ...(b.guest_phone ? { guestPhone: b.guest_phone } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
    status: b.status,
    locale: b.locale ?? 'en',
    createdAt: b.created_at,
    ...(b.table_id ? { tableId: b.table_id } : {}),
    ...(b.joined_table_ids?.length ? { joinedTableIds: b.joined_table_ids } : {}),
    ...(b.seat_indices ? { seatIndices: b.seat_indices } : {}),
    ...(b.requested_area ? { area: b.requested_area } : {}),
    ...(b.ref_code ? { refCode: b.ref_code } : {}),
    ...(b.cancel_code ? { cancelCode: b.cancel_code } : {}),
  }));
}

/** Every booking between two dates inclusive, for the admin's day view. */
export async function fetchBookingsBetween(
  db: SupabaseClient,
  from: string,
  to: string,
): Promise<Booking[]> {
  const { data, error } = await db
    .from('bookings')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date')
    .order('time');

  if (error) throw error;

  return (data ?? []).map((b) => ({
    id: b.id,
    date: b.date,
    time: b.time,
    partySize: b.party_size,
    guestName: b.guest_name,
    ...(b.guest_email ? { guestEmail: b.guest_email } : {}),
    ...(b.guest_phone ? { guestPhone: b.guest_phone } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
    status: b.status,
    locale: b.locale ?? 'en',
    createdAt: b.created_at,
    ...(b.table_id ? { tableId: b.table_id } : {}),
    ...(b.joined_table_ids?.length ? { joinedTableIds: b.joined_table_ids } : {}),
    ...(b.seat_indices ? { seatIndices: b.seat_indices } : {}),
    ...(b.requested_area ? { area: b.requested_area } : {}),
    ...(b.ref_code ? { refCode: b.ref_code } : {}),
    ...(b.cancel_code ? { cancelCode: b.cancel_code } : {}),
  }));
}

/**
 * Confirm, cancel, seat or no-show a booking.
 *
 * Nothing is ever deleted here. A cancelled table that still shows in the day's
 * history is how you answer "but I called and cancelled" three weeks later.
 *
 * `cancelled_by` is set alongside so the admin's live notifier can tell this
 * apart from a guest's own cancellation: staff cancelling from the board is not
 * news to the person who just clicked it, so it is stamped 'staff' and stays
 * quiet, while any other transition clears the marker - reinstating a table a
 * guest had cancelled must not leave it looking guest-cancelled.
 */
export async function setBookingStatus(
  db: SupabaseClient,
  id: string,
  status: BookingStatus,
): Promise<void> {
  const { error } = await db
    .from('bookings')
    .update({ status, cancelled_by: status === 'cancelled' ? 'staff' : null })
    .eq('id', id);
  if (error) throw error;
}

/**
 * How many requests still need a decision, today onward.
 *
 * For the admin's standing "waiting on you" badge - a `head` count, so it never
 * pulls the guest book back just to show a number. Past days are left out: a
 * pending request for a night that has already happened is not something anyone
 * can still act on.
 */
export async function countPendingBookings(db: SupabaseClient, fromDate: string): Promise<number> {
  const { count, error } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .gte('date', fromDate);
  if (error) throw error;
  return count ?? 0;
}

/** The date of the soonest pending request, so a "waiting" badge can jump straight to it. */
export async function fetchClosestPendingDate(db: SupabaseClient, fromDate: string): Promise<string | null> {
  const { data, error } = await db
    .from('bookings')
    .select('date')
    .eq('status', 'pending')
    .gte('date', fromDate)
    .order('date', { ascending: true })
    .order('time', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.date ?? null;
}

/**
 * The date of every new pending request or guest cancellation since a point
 * in time - one entry per event, dates repeat. Feeds the "new events" badge:
 * unlike `countPendingBookings` (a running total of what still needs a
 * decision), this is per-device - each caller compares against whenever it
 * was last looked at, so it counts what's new to *this screen*, not overall.
 *
 * Same two event types `BookingNotifier`'s live toasts already watch for: a
 * fresh request (an INSERT landing `pending`), or a guest freeing their own
 * table (`booking_changes` with no `changed_by` - nobody signed in did it -
 * whose tracked diff moved `status` to `cancelled`).
 */
export async function fetchNewEventDates(db: SupabaseClient, since: string): Promise<string[]> {
  const [created, changed] = await Promise.all([
    db.from('bookings').select('date').eq('status', 'pending').gt('created_at', since),
    db.from('booking_changes').select('changes, bookings(date)').is('changed_by', null).gt('changed_at', since),
  ]);
  if (created.error) throw created.error;
  if (changed.error) throw changed.error;

  const createdDates = (created.data ?? []).map((row) => row.date as string);

  const cancelledDates = (changed.data ?? [])
    .filter((row) => {
      const change = (row.changes as Record<string, { old: unknown; new: unknown }>).status;
      return change?.new === 'cancelled';
    })
    .map((row) => {
      const booking = row.bookings as { date: string } | { date: string }[] | null;
      return Array.isArray(booking) ? booking[0]?.date : booking?.date;
    })
    .filter((d): d is string => Boolean(d));

  return [...createdDates, ...cancelledDates];
}

/**
 * Seats a party at a table, or clears the seating.
 *
 * `book_table` already does this automatically when a table fits - this is
 * for the rest: a `pending` request staff confirm by hand, where nothing was
 * ever assigned, or a party that needs moving to a different table. Clears
 * `joined_table_ids` too - a manual pick names one specific table, so any
 * run `book_table` had paired with it is no longer part of this booking and
 * must not go on reading as occupied.
 *
 * Routed through `assign_booking_seats` rather than a plain update - the
 * same re-validation `reschedule_booking` does (closed-for-the-night, no
 * double-booking) applies here too, since this is the other place a table
 * gets written onto a booking.
 */
export async function setBookingTable(
  db: SupabaseClient,
  id: string,
  tableId: string | null,
): Promise<void> {
  const { error } = await db.rpc('assign_booking_seats', {
    p_id: id,
    p_table_id: tableId,
  });
  if (error) throw error;
}

/**
 * Seats a party at exactly the chairs staff picked on the floor plan, and
 * optionally further tables joined to it - mirroring how the auto-allocator
 * combines a run of tables for a party too big for one, but staff-picked. A
 * joined table is always held in full (there's no `seat_indices` column for
 * it), so only the primary table's chairs are ever specific.
 *
 * `null` for `tableId` clears everything, back to "no table assigned".
 *
 * Routed through `assign_booking_seats`, which re-checks the primary table
 * and every joined table are actually free before writing - a raw update
 * here trusted whatever the floor plan showed the browser a moment earlier.
 */
export async function setBookingSeats(
  db: SupabaseClient,
  id: string,
  tableId: string | null,
  seatIndices: number[] | null,
  joinedTableIds: string[] = [],
): Promise<void> {
  const { error } = await db.rpc('assign_booking_seats', {
    p_id: id,
    p_table_id: tableId,
    p_seat_indices: tableId ? seatIndices : null,
    p_joined_table_ids: tableId ? joinedTableIds : [],
  });
  if (error) throw error;
}

/**
 * Edits the contact details of a booking - name, phone, email, notes.
 *
 * None of these change which table fits, so unlike a move they run straight
 * through row-level security with no re-allocation. Only the keys passed are
 * touched; an empty phone/email/notes clears the column, but the name, once a
 * booking exists, is never blanked.
 */
export interface BookingContactPatch {
  guestName?: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  notes?: string | null;
}

export async function updateBookingContact(
  db: SupabaseClient,
  id: string,
  patch: BookingContactPatch,
): Promise<void> {
  const update: Record<string, string | null> = {};
  if (patch.guestName !== undefined) {
    const name = patch.guestName.trim();
    if (!name) throw new Error('A booking needs a name.');
    update.guest_name = name;
  }
  if (patch.guestEmail !== undefined) update.guest_email = patch.guestEmail?.trim() || null;
  if (patch.guestPhone !== undefined) update.guest_phone = patch.guestPhone?.trim() || null;
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  if (Object.keys(update).length === 0) return;

  const { error } = await db.from('bookings').update(update).eq('id', id);
  if (error) throw error;
}

/**
 * Moves a booking to a new time, date, party size, or area, re-fitting a table
 * for it - the `reschedule_booking` RPC (migration 0029), which re-runs the
 * allocator against the existing row. Returns the resulting status: `confirmed`
 * if a table fit the new shape, `pending` if nothing did.
 */
export async function rescheduleBooking(
  db: SupabaseClient,
  id: string,
  input: { date: string; time: string; partySize: number; area?: BookingArea | null },
): Promise<BookingStatus> {
  const { data, error } = await db.rpc('reschedule_booking', {
    p_id: id,
    p_date: input.date,
    p_time: input.time,
    p_party: input.partySize,
    p_area: input.area ?? null,
  });
  if (error) throw error;
  return data as BookingStatus;
}

/**
 * Finds bookings by guest name, phone, email, or reservation code, across every
 * date - the lookup for "a guest is on the phone quoting TN-01011" or "the
 * Dubois table sometime next week", which paging day-by-day could never answer.
 *
 * Staff-only by row-level security, same as every other read of the guest book.
 * The term is stripped of the characters PostgREST's `or` filter treats as
 * syntax, so a stray comma or parenthesis narrows the search rather than
 * breaking it.
 */
export async function searchBookings(db: SupabaseClient, term: string): Promise<Booking[]> {
  const clean = term.trim().replace(/[%,()\\]/g, ' ').trim();
  if (clean.length < 2) return [];
  const like = `%${clean}%`;

  const { data, error } = await db
    .from('bookings')
    .select('*')
    .or(
      `guest_name.ilike.${like},guest_email.ilike.${like},guest_phone.ilike.${like},ref_code.ilike.${like}`,
    )
    .order('date', { ascending: false })
    .order('time')
    .limit(50);

  if (error) throw error;

  return (data ?? []).map((b) => ({
    id: b.id,
    date: b.date,
    time: b.time,
    partySize: b.party_size,
    guestName: b.guest_name,
    ...(b.guest_email ? { guestEmail: b.guest_email } : {}),
    ...(b.guest_phone ? { guestPhone: b.guest_phone } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
    status: b.status,
    locale: b.locale ?? 'en',
    createdAt: b.created_at,
    ...(b.table_id ? { tableId: b.table_id } : {}),
    ...(b.joined_table_ids?.length ? { joinedTableIds: b.joined_table_ids } : {}),
    ...(b.seat_indices ? { seatIndices: b.seat_indices } : {}),
    ...(b.requested_area ? { area: b.requested_area } : {}),
    ...(b.ref_code ? { refCode: b.ref_code } : {}),
    ...(b.cancel_code ? { cancelCode: b.cancel_code } : {}),
  }));
}

export async function addBlackout(
  db: SupabaseClient,
  input: { date: string; reason: string; from?: string; to?: string },
): Promise<void> {
  const { error } = await db.from('blackouts').insert({
    date: input.date,
    reason: input.reason,
    from: input.from ?? null,
    to: input.to ?? null,
  });
  if (error) throw error;
}

export async function removeBlackout(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('blackouts').delete().eq('id', id);
  if (error) throw error;
}

export interface AreaClosure {
  id: string;
  area: BookingArea;
  fromDate: string;
  toDate: string;
  reason: string;
}

/**
 * Closing one area for a stretch of dates - the terrace out for a rainy
 * weekend - without touching `blackouts`, which closes the whole venue.
 */
export async function fetchAreaClosures(db: SupabaseClient): Promise<AreaClosure[]> {
  const { data, error } = await db
    .from('area_closures')
    .select('id, area, from_date, to_date, reason')
    .order('from_date');
  if (error) throw error;

  return (data ?? []).map((c) => ({
    id: c.id as string,
    area: c.area as BookingArea,
    fromDate: c.from_date as string,
    toDate: c.to_date as string,
    reason: c.reason as string,
  }));
}

export async function addAreaClosure(
  db: SupabaseClient,
  input: { area: BookingArea; fromDate: string; toDate: string; reason: string },
): Promise<void> {
  const { error } = await db.from('area_closures').insert({
    area: input.area,
    from_date: input.fromDate,
    to_date: input.toDate,
    reason: input.reason,
  });
  if (error) throw error;
}

export async function removeAreaClosure(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('area_closures').delete().eq('id', id);
  if (error) throw error;
}

export interface TableDayOverride {
  id: string;
  date: string;
  kind: 'seats_delta' | 'closed' | 'adhoc';
  /** Set for seats_delta/closed - the real table this applies to. */
  tableId: string | null;
  seatsDelta: number | null;
  /** adhoc-only: the table's own definition, for the one night it exists. */
  name: string | null;
  seats: number | null;
  minSeats: number | null;
  area: BookingArea | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

const DAY_OVERRIDE_COLUMNS =
  'id, date, kind, table_id, seats_delta, name, seats, min_seats, area, x, y, w, h';

function toDayOverride(row: Record<string, unknown>): TableDayOverride {
  return {
    id: row.id as string,
    date: row.date as string,
    kind: row.kind as TableDayOverride['kind'],
    tableId: (row.table_id as string | null) ?? null,
    seatsDelta: (row.seats_delta as number | null) ?? null,
    name: (row.name as string | null) ?? null,
    seats: (row.seats as number | null) ?? null,
    minSeats: (row.min_seats as number | null) ?? null,
    area: (row.area as BookingArea | null) ?? null,
    x: (row.x as number | null) ?? null,
    y: (row.y as number | null) ?? null,
    w: (row.w as number | null) ?? null,
    h: (row.h as number | null) ?? null,
  };
}

/** Every override forcing a change onto one date - a chair added, a table taken out, a pop-up table dropped in. */
export async function fetchDayOverrides(db: SupabaseClient, date: string): Promise<TableDayOverride[]> {
  const { data, error } = await db
    .from('table_day_overrides')
    .select(DAY_OVERRIDE_COLUMNS)
    .eq('date', date);
  if (error) throw error;
  return (data ?? []).map(toDayOverride);
}

export async function addSeatsDeltaOverride(
  db: SupabaseClient,
  input: { date: string; tableId: string; seatsDelta: number },
): Promise<void> {
  const { error } = await db.from('table_day_overrides').insert({
    date: input.date,
    kind: 'seats_delta',
    table_id: input.tableId,
    seats_delta: input.seatsDelta,
  });
  if (error) throw error;
}

export async function addClosedOverride(
  db: SupabaseClient,
  input: { date: string; tableId: string },
): Promise<void> {
  const { error } = await db.from('table_day_overrides').insert({
    date: input.date,
    kind: 'closed',
    table_id: input.tableId,
  });
  if (error) throw error;
}

export interface AddAdhocOverrideInput {
  date: string;
  name: string;
  seats: number;
  minSeats: number;
  area: BookingArea;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** A table that exists for one night only - a pop-up for a private event. */
export async function addAdhocOverride(db: SupabaseClient, input: AddAdhocOverrideInput): Promise<void> {
  const { error } = await db.from('table_day_overrides').insert({
    date: input.date,
    kind: 'adhoc',
    name: input.name,
    seats: input.seats,
    min_seats: input.minSeats,
    area: input.area,
    x: input.x ?? null,
    y: input.y ?? null,
    w: input.w ?? null,
    h: input.h ?? null,
  });
  if (error) throw error;
}

export async function moveAdhocOverride(db: SupabaseClient, id: string, x: number, y: number): Promise<void> {
  const { error } = await db.from('table_day_overrides').update({ x, y }).eq('id', id);
  if (error) throw error;
}

export async function removeDayOverride(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('table_day_overrides').delete().eq('id', id);
  if (error) throw error;
}

/** Changes an existing seats_delta override's count - a second "+1 chair" tops up rather than adding a duplicate row. */
export async function updateSeatsDeltaOverride(db: SupabaseClient, id: string, seatsDelta: number): Promise<void> {
  const { error } = await db.from('table_day_overrides').update({ seats_delta: seatsDelta }).eq('id', id);
  if (error) throw error;
}

/** The shared note for one service day, if staff have set one. */
export async function fetchDayNote(db: SupabaseClient, date: string): Promise<DayNote | null> {
  const { data, error } = await db.from('day_notes').select('date, note, updated_at').eq('date', date).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { date: data.date, note: data.note, updatedAt: data.updated_at };
}

/** Sets the day's note, or clears it entirely when `note` is blank. */
export async function setDayNote(db: SupabaseClient, date: string, note: string): Promise<void> {
  const trimmed = note.trim();
  if (!trimmed) {
    const { error } = await db.from('day_notes').delete().eq('date', date);
    if (error) throw error;
    return;
  }
  const { error } = await db.from('day_notes').upsert({ date, note: trimmed });
  if (error) throw error;
}

/** The tracked history of a booking's operational changes, most recent first. */
export async function fetchBookingChanges(db: SupabaseClient, bookingId: string): Promise<BookingChange[]> {
  const { data, error } = await db
    .from('booking_changes')
    .select('id, changed_at, changes, staff(email)')
    .eq('booking_id', bookingId)
    .order('changed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const staff = row.staff as { email: string } | { email: string }[] | null;
    const email = Array.isArray(staff) ? staff[0]?.email : staff?.email;
    return {
      id: row.id as string,
      changedAt: row.changed_at as string,
      changedBy: email ?? undefined,
      changes: row.changes as BookingChange['changes'],
    };
  });
}

/** Bottles at or below their reorder point, for the supplier email. */
export async function fetchLowStock(db: SupabaseClient) {
  const { data, error } = await db.from('low_stock').select('*');
  if (error) throw error;
  return data ?? [];
}

// ── social posts ──────────────────────────────────────────────────────────────
// The "From the street" tiles on the homepage. Curated by marketing staff;
// public reads only the published ones, admin sees all.

export interface SocialPost {
  id: string;
  imageUrl: string;
  label: string;
  title: string;
  href: string;
  position: number;
  published: boolean;
  instagramId?: string;
}

function toSocialPost(r: Record<string, unknown>): SocialPost {
  return {
    id: r.id as string,
    imageUrl: r.image_url as string,
    label: r.label as string,
    title: r.title as string,
    href: r.href as string,
    position: (r.position as number) ?? 0,
    published: Boolean(r.published),
    instagramId: (r.instagram_id as string | null) ?? undefined,
  };
}

/** Published social posts for the homepage, in staff-arranged order. */
export async function fetchPublishedSocialPosts(db: SupabaseClient): Promise<SocialPost[]> {
  const { data, error } = await db
    .from('social_posts')
    .select('*')
    .eq('published', true)
    .order('position');
  if (error) throw error;
  return (data ?? []).map(toSocialPost);
}

/** All social posts including drafts - for the admin editor. */
export async function fetchAllSocialPosts(db: SupabaseClient): Promise<SocialPost[]> {
  const { data, error } = await db.from('social_posts').select('*').order('position');
  if (error) throw error;
  return (data ?? []).map(toSocialPost);
}

// ── app settings ─────────────────────────────────────────────────────────────
// Key/value store for server-side config: Instagram token, sync timestamps, etc.

/** Fetch a named subset of app_settings rows, returned as a plain object. */
export async function fetchAppSettings(
  db: SupabaseClient,
  keys: string[],
): Promise<Record<string, string>> {
  const { data } = await db.from('app_settings').select('key,value').in('key', keys);
  return Object.fromEntries(
    (data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]),
  );
}

// ── current story ─────────────────────────────────────────────────────────────

export interface CurrentStory {
  imageUrl: string;
  href: string;
  account: string;
  expiresAt: string;
}

/**
 * Returns the active Instagram story, or null if none is set or it has expired.
 * The homepage calls this alongside fetchPublishedSocialPosts.
 */
export async function fetchCurrentStory(db: SupabaseClient): Promise<CurrentStory | null> {
  const settings = await fetchAppSettings(db, [
    'story_image_url',
    'story_href',
    'story_account',
    'story_expires_at',
  ]);
  const { story_image_url, story_href, story_account, story_expires_at } = settings;
  if (!story_image_url || !story_expires_at) return null;
  if (new Date(story_expires_at) <= new Date()) return null;
  return {
    imageUrl: story_image_url,
    href: story_href ?? '',
    account: story_account ?? '@tannin_antwerp',
    expiresAt: story_expires_at,
  };
}
