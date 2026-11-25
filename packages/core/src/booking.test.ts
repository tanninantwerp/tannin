import { describe, expect, it } from 'vitest';
import {
  BOOKING_HORIZON_DAYS,
  FIELD_LIMITS,
  MAX_PARTY_ONLINE,
  SLOT_MINUTES,
  addDays,
  availabilityFor,
  calendar,
  toISODate,
  validateBooking,
  windowFor,
} from './booking';

/**
 * These functions decide what the website offers a stranger, and since bookings
 * started confirming themselves that is a decision nobody reviews before it
 * takes effect. Worth pinning down.
 *
 * Every test passes an explicit `today`. A suite that depends on the real clock
 * passes all year and then fails on a Sunday, or in the week the horizon rolls
 * over, and by then nobody remembers why.
 */

// A Wednesday, chosen so the weekday arithmetic below is easy to follow.
const TODAY = new Date('2026-08-05T12:00:00Z');
const NO_BLACKOUTS = [] as const;

describe('toISODate', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(toISODate(new Date('2026-08-05T12:00:00Z'))).toBe('2026-08-05');
  });

  it('answers in Brussels time, not UTC and not the device zone', () => {
    // The bar is in Antwerp, so "what day is it" has to be answered there. At
    // 23:30 UTC on the 5th it is already half past one on the 6th in Antwerp,
    // and a calendar built in UTC would still be offering yesterday.
    expect(toISODate(new Date('2026-08-05T23:30:00Z'))).toBe('2026-08-06');
    expect(toISODate(new Date('2026-08-05T00:30:00Z'))).toBe('2026-08-05');
  });

  it('follows the summer/winter shift rather than a fixed offset', () => {
    // August is CEST (UTC+2), January is CET (UTC+1). A hardcoded +2 would put
    // this one on the 6th.
    expect(toISODate(new Date('2026-01-05T23:30:00Z'))).toBe('2026-01-06');
    expect(toISODate(new Date('2026-01-05T22:30:00Z'))).toBe('2026-01-05');
    expect(toISODate(new Date('2026-08-05T22:30:00Z'))).toBe('2026-08-06');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(toISODate(addDays(new Date('2026-08-31T12:00:00Z'), 1))).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(toISODate(addDays(new Date('2026-12-31T12:00:00Z'), 1))).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(toISODate(addDays(new Date('2028-02-28T12:00:00Z'), 1))).toBe('2028-02-29');
  });

  it('goes backwards', () => {
    expect(toISODate(addDays(new Date('2026-08-05T12:00:00Z'), -6))).toBe('2026-07-30');
  });
});

describe('windowFor', () => {
  it('opens later on weekdays than at the weekend', () => {
    expect(windowFor('2026-08-05')?.opens).toBe('17:00'); // Wednesday
    expect(windowFor('2026-08-08')?.opens).toBe('14:00'); // Saturday
    expect(windowFor('2026-08-09')?.opens).toBe('14:00'); // Sunday
  });

  it('finds a window for all seven days', () => {
    const week = Array.from({ length: 7 }, (_, i) =>
      windowFor(toISODate(addDays(TODAY, i))),
    );
    expect(week.every(Boolean)).toBe(true);
  });

  it('reads the weekday in UTC, not the device zone', () => {
    // Sunday. Parsed as local midnight in a negative offset this becomes
    // Saturday, and the room would advertise the wrong opening time.
    expect(windowFor('2026-08-09')?.closes).toBe('23:00');
  });

  it('honours custom windows, and treats a missing weekday as closed', () => {
    // A caller with the live hours from the admin - here, open Wednesdays only.
    const custom = [{ weekday: 3, opens: '18:00', closes: '23:00', lastSeating: '21:00' }];
    expect(windowFor('2026-08-05', custom)?.opens).toBe('18:00'); // Wednesday
    expect(windowFor('2026-08-08', custom)).toBeUndefined(); // Saturday - not in the list
  });
});

describe('availabilityFor', () => {
  const on = (isoDate: string, blackouts: Parameters<typeof availabilityFor>[0]['blackouts'] = NO_BLACKOUTS) =>
    availabilityFor({ isoDate, blackouts, today: TODAY });

  it('is closed on a weekday absent from custom windows', () => {
    // Live hours that drop Saturdays: the picker must offer no slots there.
    const custom = [{ weekday: 3, opens: '17:00', closes: '23:00', lastSeating: '21:30' }];
    const sat = availabilityFor({ isoDate: '2026-08-08', blackouts: NO_BLACKOUTS, today: TODAY, windows: custom });
    expect(sat.bookable).toBe(false);
    expect(sat.reason).toBe('closed');
    const wed = availabilityFor({ isoDate: '2026-08-05', blackouts: NO_BLACKOUTS, today: TODAY, windows: custom });
    expect(wed.bookable).toBe(true);
    expect(wed.slots.length).toBeGreaterThan(0);
  });

  it('refuses yesterday', () => {
    const day = on('2026-08-04');
    expect(day.bookable).toBe(false);
    expect(day.reason).toBe('past');
  });

  it('allows today', () => {
    expect(on('2026-08-05').bookable).toBe(true);
  });

  it('allows the last day of the horizon and refuses the day after', () => {
    const last = toISODate(addDays(TODAY, BOOKING_HORIZON_DAYS));
    const past = toISODate(addDays(TODAY, BOOKING_HORIZON_DAYS + 1));
    expect(on(last).bookable).toBe(true);
    expect(on(past).reason).toBe('beyond-horizon');
  });

  it('starts at opening and ends at last seating', () => {
    const day = on('2026-08-05');
    expect(day.slots.at(0)).toBe('17:00');
    expect(day.slots.at(-1)).toBe('21:30');
  });

  it('spaces slots by SLOT_MINUTES', () => {
    const [first = '', second = ''] = on('2026-08-05').slots;
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    expect(minutes(second) - minutes(first)).toBe(SLOT_MINUTES);
  });

  it('offers more slots on a Saturday, which opens three hours earlier', () => {
    expect(on('2026-08-08').slots.length).toBeGreaterThan(on('2026-08-05').slots.length);
  });

  it('closes the whole day for a blackout with no hours', () => {
    const day = on('2026-08-07', [
      { id: '1', date: '2026-08-07', reason: 'Private hire' },
    ]);
    expect(day.bookable).toBe(false);
    expect(day.reason).toBe('blocked');
    expect(day.blockedBy).toBe('Private hire');
    expect(day.slots).toEqual([]);
  });

  it('carves a hole out of a day for a partial blackout', () => {
    const day = on('2026-08-07', [
      { id: '1', date: '2026-08-07', reason: 'Tasting', from: '18:00', to: '20:00' },
    ]);
    expect(day.bookable).toBe(true);
    expect(day.slots).toContain('17:45');
    expect(day.slots).not.toContain('18:00');
    expect(day.slots).not.toContain('19:45');
    // `to` is exclusive: the room is back in use at 20:00.
    expect(day.slots).toContain('20:00');
  });

  it('ignores a blackout on another day', () => {
    const day = on('2026-08-07', [
      { id: '1', date: '2026-08-08', reason: 'Wedding' },
    ]);
    expect(day.bookable).toBe(true);
  });

  it('never reports full - occupancy is the database question', () => {
    const days = calendar({ blackouts: NO_BLACKOUTS, days: 30, today: TODAY });
    expect(days.some((d) => (d.reason as string) === 'full')).toBe(false);
  });
});

describe('calendar', () => {
  it('returns the requested number of days starting today', () => {
    const days = calendar({ blackouts: NO_BLACKOUTS, days: 28, today: TODAY });
    expect(days).toHaveLength(28);
    expect(days[0]?.date).toBe('2026-08-05');
    expect(days.at(-1)?.date).toBe(toISODate(addDays(TODAY, 27)));
  });

  it('marks a blacked-out day unbookable within the strip', () => {
    const days = calendar({
      blackouts: [{ id: '1', date: '2026-08-07', reason: 'Closed' }],
      days: 7,
      today: TODAY,
    });
    expect(days.find((d) => d.date === '2026-08-07')?.bookable).toBe(false);
  });
});

describe('validateBooking', () => {
  const valid = {
    date: '2026-08-07',
    time: '19:30',
    partySize: 2,
    guestName: 'Marieke De Smet',
    guestEmail: 'marieke@example.com',
    guestPhone: '0470 00 00 00',
  };

  it('accepts a complete draft', () => {
    expect(validateBooking(valid)).toEqual({});
  });

  it('requires a date and a time', () => {
    // Dropped rather than set to undefined: `exactOptionalPropertyTypes` draws
    // a distinction between the two, and "the guest has not picked yet" is a
    // missing key, not a present one holding nothing.
    const { date: _d, ...noDate } = valid;
    const { time: _t, ...noTime } = valid;
    expect(validateBooking(noDate)).toHaveProperty('date');
    expect(validateBooking(noTime)).toHaveProperty('time');
  });

  it('requires a name that is not just whitespace', () => {
    expect(validateBooking({ ...valid, guestName: '   ' })).toHaveProperty('guestName');
  });

  it('requires a phone number', () => {
    expect(validateBooking({ ...valid, guestPhone: '' }).guestPhone).toBe('guestPhone');
    expect(validateBooking({ ...valid, guestPhone: '   ' }).guestPhone).toBe('guestPhone');
    const { guestPhone: _p, ...noPhone } = valid;
    expect(validateBooking(noPhone)).toHaveProperty('guestPhone');
  });

  it('rejects an address with no @ or no dot', () => {
    expect(validateBooking({ ...valid, guestEmail: 'marieke' })).toHaveProperty('guestEmail');
    expect(validateBooking({ ...valid, guestEmail: 'marieke@example' })).toHaveProperty('guestEmail');
    expect(validateBooking({ ...valid, guestEmail: 'a b@example.com' })).toHaveProperty('guestEmail');
  });

  it('tells a missing address apart from a malformed one', () => {
    // Different keys because they want different sentences: one explains why we
    // are asking, the other says the answer is wrong.
    expect(validateBooking({ ...valid, guestEmail: '' }).guestEmail).toBe('guestEmail');
    expect(validateBooking({ ...valid, guestEmail: 'marieke@' }).guestEmail).toBe('emailInvalid');
  });

  it('accepts an address with a plus tag and a subdomain', () => {
    expect(validateBooking({ ...valid, guestEmail: 'a+tannin@mail.example.be' })).toEqual({});
  });

  it('rejects a party of zero and accepts a party of one', () => {
    expect(validateBooking({ ...valid, partySize: 0 })).toHaveProperty('partySize');
    expect(validateBooking({ ...valid, partySize: 1 })).toEqual({});
  });

  it('accepts the largest online party and rejects one more', () => {
    expect(validateBooking({ ...valid, partySize: MAX_PARTY_ONLINE })).toEqual({});
    expect(validateBooking({ ...valid, partySize: MAX_PARTY_ONLINE + 1 }).partySize).toBe(
      'partyMax',
    );
  });

  /*
   * Length. The columns behind these are `text`, which has no ceiling of its
   * own, so without this a stranger could post a megabyte of notes and we would
   * store it, email it and put it on the board. The migration is the real
   * guard; these check that the form says so first.
   */
  describe('length', () => {
    const of = (n: number) => 'a'.repeat(n);

    it('accepts a field at its limit and rejects one character more', () => {
      for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
        // The email limit is a length, not a shape - keep it a valid address.
        const fill =
          field === 'guestEmail'
            ? (n: number) => `${of(n - '@example.com'.length)}@example.com`
            : of;

        expect(validateBooking({ ...valid, [field]: fill(limit) })).toEqual({});
        expect(validateBooking({ ...valid, [field]: fill(limit + 1) })).toHaveProperty(field);
      }
    });

    it('measures what will be stored, not what was typed', () => {
      // The route trims before inserting, so trailing spaces are not length.
      const name = `${of(FIELD_LIMITS.guestName)}      `;
      expect(validateBooking({ ...valid, guestName: name })).toEqual({});
    });

    it('leaves notes optional', () => {
      // Absent, and present but empty. A form that has been tabbed through
      // sends the second.
      expect(validateBooking(valid)).toEqual({});
      expect(validateBooking({ ...valid, notes: '' })).toEqual({});
    });
  });

  it('reports every problem at once rather than one at a time', () => {
    // The form shows all of these together; finding them one refresh at a time
    // is the difference between filling a form once and filling it four times.
    const errors = validateBooking({});
    expect(Object.keys(errors).sort()).toEqual([
      'date',
      'guestEmail',
      'guestName',
      'guestPhone',
      'partySize',
      'time',
    ]);
  });
});
