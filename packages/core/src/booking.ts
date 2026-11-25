import type { Blackout, ServiceWindow } from './types';

/**
 * Availability rules. The website, the apps and the server all call these, so a
 * table can never be offered on one surface and refused on another.
 */

/** How far ahead the public may book. */
export const BOOKING_HORIZON_DAYS = 365;

/**
 * Largest party the *in-house* booking flow takes online.
 *
 * This governs `/book` and the demo only. Ta-nnin itself books through Zenchef,
 * and Zenchef is set to send anything above `LARGE_PARTY_CONTACT_ABOVE` to the
 * venue instead - so that, not this, is the number the public site quotes. The
 * two are allowed to differ because they guard different doors; if the bar ever
 * brings booking back in-house they should be reconciled.
 */
export const MAX_PARTY_ONLINE = 8;

/**
 * Above this many people, the website asks you to get in touch rather than book
 * online. Confirmed with the venue on 2026-09-07 as matching Zenchef, which is
 * what actually takes the reservations.
 *
 * Declared once so the Visit page, the home page and every booking CTA quote
 * the same number - the site previously said "above eight" in one place while
 * Zenchef said six in another, which is the sort of contradiction a guest only
 * discovers after they have been sent somewhere else.
 */
export const LARGE_PARTY_CONTACT_ABOVE = 6;

/** Minutes between offered slots. */
export const SLOT_MINUTES = 15;

/**
 * How long each free-text field may be.
 *
 * The columns behind these are `text`, which in Postgres has no length at all -
 * so without a check somewhere, a stranger can post a megabyte of notes and we
 * will store it, put it in an email, and render it on the board.
 *
 * The real ceiling is the `check` constraint in migration 0009; that is what
 * cannot be talked past. These numbers exist so the form can say "that is too
 * long" while the guest is still typing, instead of the server rejecting a
 * filled-in form with nothing useful to show for it. They must match the
 * migration, and the migration is the one to change first.
 *
 * 254 for the address is not a guess - it is the longest a mailbox may be
 * under RFC 5321, so anything longer is not an address that was going to
 * receive a confirmation anyway.
 */
export const FIELD_LIMITS = {
  guestName: 80,
  guestEmail: 254,
  guestPhone: 32,
  notes: 500,
} as const;

/**
 * How long a table is held is deliberately NOT defined here.
 *
 * It lives in `booking_settings.turn_minutes`, because the only thing that
 * needs it is the overlap check inside `free_slots` and `book_table`, and
 * because it is a number Tawat should be able to change from the admin without
 * a deploy. A copy in this file would only ever drift out of step with the one
 * doing the work.
 */

/**
 * Open seven days: 17:00 on weekdays, 14:00 at the weekend.
 *
 * `lastSeating` is the kitchen's last call, not closing - the bar carries on
 * afterwards off the afterhours card. Closing times run past midnight, so
 * `00:30` means half past midnight the following morning.
 */
export const SERVICE_WINDOWS: readonly ServiceWindow[] = [
  { weekday: 1, opens: '17:00', closes: '00:00', lastSeating: '21:30' }, // Monday
  { weekday: 2, opens: '17:00', closes: '00:00', lastSeating: '21:30' },
  { weekday: 3, opens: '17:00', closes: '00:00', lastSeating: '21:30' },
  { weekday: 4, opens: '17:00', closes: '00:00', lastSeating: '21:30' },
  { weekday: 5, opens: '17:00', closes: '00:30', lastSeating: '21:30' }, // Friday
  { weekday: 6, opens: '14:00', closes: '00:30', lastSeating: '21:30' }, // Saturday
  { weekday: 0, opens: '14:00', closes: '23:00', lastSeating: '21:30' }, // Sunday
];

/** `YYYY-MM-DD` for a date, in Europe/Brussels rather than the device zone. */
export function toISODate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The service window for a date's weekday, or undefined when the room is
 * closed that day.
 *
 * `windows` defaults to the built-in constant so every existing caller keeps
 * working, but callers with the live hours from `service_windows` pass them in
 * - the website's date picker and the booking guard both do, so a change staff
 * make in the admin takes effect without a deploy. A day that is closed simply
 * has no row in the open-windows list, so this returns undefined for it, the
 * same as a weekday the room never opens.
 */
export function windowFor(
  isoDate: string,
  windows: readonly ServiceWindow[] = SERVICE_WINDOWS,
): ServiceWindow | undefined {
  // Parsed as UTC noon so the weekday cannot slip across a timezone boundary.
  const weekday = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return windows.find((w) => w.weekday === weekday);
}

export interface DayAvailability {
  date: string;
  /** False when closed, blacked out, in the past or beyond the horizon. */
  bookable: boolean;
  /**
   * Shown to the guest when `bookable` is false.
   *
   * There is no 'full' here on purpose. Whether the room has a table is a
   * question about the table plan and who is already booked, which this
   * function cannot see and should not guess at - `free_slots` answers it
   * against the real furniture.
   */
  reason?: 'past' | 'beyond-horizon' | 'closed' | 'blocked';
  /** The blackout note, e.g. "Argenta corporate". Admin-facing. */
  blockedBy?: string;
  slots: readonly string[];
}

export interface AvailabilityInput {
  isoDate: string;
  blackouts: readonly Blackout[];
  today?: Date;
  /** The live hours, if fetched; defaults to the built-in weekly windows. */
  windows?: readonly ServiceWindow[];
}

/**
 * Which times the bar would offer on one day, before anyone has booked.
 *
 * This answers a question about the calendar, not about the room: are we open,
 * is the day blacked out, is it in the past or too far ahead, and what slots
 * does the service window produce. It knows nothing about tables, and it used
 * to pretend otherwise - there was a capacity check with a hardcoded 40 covers
 * that the browser could never trigger, because reading the guest book is
 * exactly what the anon key is forbidden to do. It was dead code giving a
 * wrong answer.
 *
 * Occupancy is `free_slots`, in Postgres, against the real table plan.
 *
 * Kept pure so the same function backs the web date picker, the app calendar
 * and the server-side re-check that runs before a booking is written.
 */
export function availabilityFor({
  isoDate,
  blackouts,
  today = new Date(),
  windows = SERVICE_WINDOWS,
}: AvailabilityInput): DayAvailability {
  const todayISO = toISODate(today);
  const horizonISO = toISODate(addDays(today, BOOKING_HORIZON_DAYS));

  if (isoDate < todayISO) return { date: isoDate, bookable: false, reason: 'past', slots: [] };
  if (isoDate > horizonISO) return { date: isoDate, bookable: false, reason: 'beyond-horizon', slots: [] };

  const blackout = blackouts.find((b) => b.date === isoDate);
  // A blackout with no from/to closes the whole day.
  if (blackout && !blackout.from) {
    return { date: isoDate, bookable: false, reason: 'blocked', blockedBy: blackout.reason, slots: [] };
  }

  const window = windowFor(isoDate, windows);
  if (!window) return { date: isoDate, bookable: false, reason: 'closed', slots: [] };

  const slots: string[] = [];
  for (let t = toMinutes(window.opens); t <= toMinutes(window.lastSeating); t += SLOT_MINUTES) {
    // A partial blackout carves a hole out of an otherwise open day.
    if (blackout?.from && blackout.to) {
      if (t >= toMinutes(blackout.from) && t < toMinutes(blackout.to)) continue;
    }
    slots.push(toHHMM(t));
  }

  return { date: isoDate, bookable: slots.length > 0, slots };
}

/** The next `days` days, for the calendar strip. */
export function calendar(input: Omit<AvailabilityInput, 'isoDate'> & { days?: number }): DayAvailability[] {
  const { days = 28, today = new Date() } = input;
  return Array.from({ length: days }, (_, i) =>
    availabilityFor({ ...input, isoDate: toISODate(addDays(today, i)) }),
  );
}

export interface BookingDraft {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  notes?: string;
}

/**
 * What is wrong with a field, as a message key rather than a sentence.
 *
 * These used to be English strings, which meant the Dutch form could not use
 * them: it looked the key up in its own catalogue and threw the string away -
 * and for the one case where the key was not simply the field name, it
 * re-derived the condition itself. So the party ceiling was tested in two
 * places, and a second such case would have been tested in three.
 *
 * Returning the key instead leaves one test per rule, and a new kind of error
 * arrives in Dutch by adding a line to the catalogue rather than by adding a
 * branch to the form.
 */
export type BookingErrorKey =
  | 'date'
  | 'time'
  | 'partySize'
  | 'partyMax'
  | 'guestName'
  | 'nameTooLong'
  | 'guestEmail'
  | 'emailInvalid'
  | 'emailTooLong'
  | 'guestPhone'
  | 'phoneTooLong'
  | 'notesTooLong';

/** Message keys, one per bad field, or an empty object when the draft is fine. */
export function validateBooking(
  draft: Partial<BookingDraft>,
): Partial<Record<keyof BookingDraft, BookingErrorKey>> {
  const errors: Partial<Record<keyof BookingDraft, BookingErrorKey>> = {};

  if (!draft.date) errors.date = 'date';
  if (!draft.time) errors.time = 'time';

  if (!draft.partySize || draft.partySize < 1) {
    errors.partySize = 'partySize';
  } else if (draft.partySize > MAX_PARTY_ONLINE) {
    errors.partySize = 'partyMax';
  }

  const name = draft.guestName?.trim() ?? '';
  if (!name) {
    errors.guestName = 'guestName';
  } else if (name.length > FIELD_LIMITS.guestName) {
    errors.guestName = 'nameTooLong';
  }

  const email = draft.guestEmail?.trim() ?? '';
  if (!email) {
    errors.guestEmail = 'guestEmail';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.guestEmail = 'emailInvalid';
  } else if (email.length > FIELD_LIMITS.guestEmail) {
    errors.guestEmail = 'emailTooLong';
  }

  /*
   * A confirmation with no way to reach someone by voice is a table staff
   * cannot save when a guest is late or the room has to move them - notes
   * stays free text, but a phone number is not optional the way it once was.
   */
  const phone = draft.guestPhone?.trim() ?? '';
  if (!phone) {
    errors.guestPhone = 'guestPhone';
  } else if (phone.length > FIELD_LIMITS.guestPhone) {
    errors.guestPhone = 'phoneTooLong';
  }
  if ((draft.notes?.trim().length ?? 0) > FIELD_LIMITS.notes) {
    errors.notes = 'notesTooLong';
  }

  return errors;
}
