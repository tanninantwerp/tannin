import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The migrations, run against a real Postgres.
 *
 * This half of the system had no tests at all, which is the wrong way round:
 * `book_table` is the thing that decides whether a stranger gets a table, and
 * it is written in the one language here that no compiler checks. A typo in it
 * is not found by `npm run build` — it is found by a guest, on a Friday.
 *
 * The Postgres is PGlite, which is the real engine compiled to WebAssembly, so
 * this needs no Docker and no server. It is not Supabase: `auth` and the two
 * roles are stubbed below, and row-level security is not exercised because
 * everything here runs as owner. What it does prove is that the migrations
 * apply in order, from nothing, and that the functions behave.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** What Supabase supplies and a bare Postgres does not. */
const SUPABASE_STUBS = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
  do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
`;

/** Read before anything regenerates it, so the staleness check has a baseline. */
const committedSetup = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'setup.sql'),
  'utf8',
);

let db: PGlite;

/** Far enough ahead to be inside the horizon whenever this happens to run. */
const DAY = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

interface BookResult {
  ok: boolean;
  status?: string;
  code?: string;
  message?: string;
}

async function book(opts: {
  email?: string;
  client?: string | null;
  name?: string;
  time?: string;
  party?: number;
  note?: string | null;
  area?: string | null;
} = {}): Promise<BookResult> {
  const {
    email = 'marieke@example.com',
    client = null,
    name = 'Marieke De Smet',
    time = '19:30',
    party = 2,
    note = null,
    area = null,
  } = opts;

  try {
    const result = await db.query<{ status: string }>(
      'select * from book_table($1::date, $2::time, $3::int, $4, $5, null, $6, $7, $8, $9)',
      [DAY, time, party, name, email, note, 'en', client, area],
    );
    return { ok: true, status: result.rows[0]?.status };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { ok: false, code: e.code, message: e.message };
  }
}

/**
 * Runs `fn` as though `auth.uid()` were a real, signed-in staff member.
 *
 * The stub in SUPABASE_STUBS hardcodes `auth.uid()` to null so the rest of
 * this file runs "as owner" — RLS is never exercised here (see the file
 * docstring). `book_table`'s staff/guest branch depends on `is_staff()`,
 * which depends on `auth.uid()`, so exercising that branch needs the stub
 * pointed at a real row for the duration of one test, then put back.
 */
async function asStaff<T>(fn: () => Promise<T>, permissions: string[] = ['bookings', 'tables']): Promise<T> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id) values (gen_random_uuid()) returning id`,
  );
  const id = rows[0].id;
  await db.query(`insert into staff (user_id, email, permissions) values ($1, $2, $3)`, [
    id,
    'staff@staff.ta-nnin.be',
    permissions,
  ]);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${id}'::uuid $$;`);
  try {
    return await fn();
  } finally {
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
  }
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUBS);

  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    // Named in the failure, so a broken migration says which one.
    await db.exec(readFileSync(join(DIR, file), 'utf8')).catch((e: Error) => {
      throw new Error(`${file}: ${e.message}`);
    });
  }
}, 120_000);

beforeEach(async () => {
  /*
   * Staff too: the permission tests count who is left holding 'people', and a
   * row surviving from the previous test makes that count quietly wrong.
   * auth.users cascades into staff, so one delete does both.
   *
   * The guard has to come off to do it — emptying the table is exactly what it
   * exists to prevent, and it fires on the cascade. Off for the teardown only,
   * which is the one moment "leave nobody who can manage people" is the point.
   */
  await db.exec(`
    alter table staff disable trigger staff_guard_last_people;
    delete from booking_throttle; delete from bookings; delete from auth.users;
    delete from area_closures; delete from table_day_overrides; delete from day_notes;
    alter table staff enable trigger staff_guard_last_people;
    -- Back to the seed defaults, so a test that changes pacing or turn times
    -- cannot leak those into the next one (booking_settings is a single row).
    update booking_settings
    set turn_minutes = 105, turn_minutes_large = 105,
        large_party_threshold = 5, buffer_minutes = 0, pace_covers = null;
  `);
});

describe('setup.sql', () => {
  /*
   * The one-paste file somebody actually runs. It is generated, so the risk is
   * not that it is wrong — it is that it is stale, or that pasting it a second
   * time blows up in the face of the person least able to tell whether that
   * matters.
   */
  const SETUP = join(dirname(fileURLToPath(import.meta.url)), 'setup.sql');

  it('matches the migrations it was generated from', () => {
    // Regenerating and diffing, rather than trusting that whoever last touched
    // a migration remembered to re-run the script.
    execFileSync(process.execPath, [join(dirname(SETUP), '../scripts/bundle-setup.mjs')], {
      stdio: 'ignore',
    });
    expect(readFileSync(SETUP, 'utf8')).toBe(committedSetup);
  });

  it('can be pasted twice without complaining', async () => {
    // The whole reason every statement in here is guarded. Somebody who has
    // lost track of what they have run should be able to just run it again.
    const fresh = await PGlite.create({ extensions: { pgcrypto } });
    await fresh.exec(SUPABASE_STUBS);

    const sql = readFileSync(SETUP, 'utf8');
    await fresh.exec(sql);
    await fresh.exec(sql);

    const wines = await fresh.query<{ n: number }>('select count(*)::int as n from wines');
    expect(wines.rows[0].n).toBeGreaterThan(100);

    // Seeded twice, still one of each — the seed truncates before inserting.
    const dupes = await fresh.query<{ n: number }>(
      `select count(*)::int as n from (
         select name, producer from wines group by name, producer having count(*) > 1
       ) d`,
    );
    expect(dupes.rows[0].n).toBe(0);
  }, 120_000);
});

describe('the migrations', () => {
  it('applies every one in order, from nothing', async () => {
    // The work is in beforeAll; reaching here at all is the assertion. Worth
    // its own test so a broken migration reads as a failure rather than as
    // twenty unrelated ones.
    const tables = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
       where table_schema = 'public'`,
    );
    expect(tables.rows[0].n).toBeGreaterThan(8);
  });

  it('loads the real table plan, not 0006 placeholders', async () => {
    const placeholders = await db.query<{ n: number }>(
      `select count(*)::int as n from dining_tables where name in ('T1','H1')`,
    );
    expect(placeholders.rows[0].n).toBe(0);
  });

  it('has all 75 covers on the books', async () => {
    // The real, measured floor plan from 0017 — 23 tables, English names.
    // Pinned because it is the number the whole allocator works from: one
    // seat missing here is a guest turned away for no reason.
    const covers = await db.query<{ all: number; bookable: number }>(
      `select sum(seats)::int as all,
              sum(seats) filter (where active)::int as bookable
       from dining_tables`,
    );
    expect(covers.rows[0]).toEqual({ all: 75, bookable: 75 });
  });

  it('seats one person at the smallest table that fits, not a table for two', async () => {
    // Falls out of "smallest table that fits" in book_table's own ordering —
    // a solo guest doesn't consume a two-top while a two-top sits empty.
    //
    // NOTE: 0017 merged the old five one-seat "Barkruk" stools (0010) into a
    // single 3-seat "Terrace — wall counter" row, but that row's own
    // `is_shared` is false — it is an exclusive table like any other, so a
    // solo booking here correctly locks all 3 stools for the turn. The tables
    // that actually carry `is_shared = true` (the Long table, the two street
    // six-tops, Counter Wall) split seat-by-seat instead — see
    // "shares a table between independent parties" below.
    await book({ party: 1 });
    const seated = await db.query<{ name: string; seats: number }>(
      `select t.name, t.seats from bookings b join dining_tables t on t.id = b.table_id`,
    );
    expect(seated.rows[0].name).toBe('Terrace — wall counter');
    expect(seated.rows[0].seats).toBe(3);
  });

  it('has three bookable areas, though the admin only ever switches two', async () => {
    // 'bar' is real for booking and filtering purposes; it just never gets its
    // own open/close button, which is an app-layer decision, not a database one.
    const areas = await db.query<{ area: string }>(
      `select distinct area from dining_tables order by area`,
    );
    expect(areas.rows.map((r) => r.area)).toEqual(['bar', 'inside', 'terrace']);
  });

  it('refuses a fourth area at the database, not just in the dropdown', async () => {
    await expect(
      db.query(`insert into dining_tables (name, seats, area) values ('Patio 1', 2, 'patio')`),
    ).rejects.toThrow(/dining_tables_area_check/);
  });

  it('puts the counter and its wall seating in the bar', async () => {
    const bar = await db.query<{ name: string }>(
      `select name from dining_tables where area = 'bar' order by name`,
    );
    expect(bar.rows.map((r) => r.name)).toEqual(['Counter Bar', 'Counter Wall', 'Window 3']);
  });
});

describe('book_table', () => {
  it('confirms outright when a table fits', async () => {
    expect((await book({ party: 2 })).status).toBe('confirmed');
  });

  it('leaves the long table for people who ask a person', async () => {
    // Sixteen seats with a minimum of ten, and the website stops at eight, so
    // no online booking can ever reach it. This is the test that fails if
    // somebody "helpfully" lowers min_seats.
    const reachable = await db.query<{ n: number }>(
      `select count(*)::int as n from dining_tables
       where active and min_seats <= 8 and seats >= 16`,
    );
    expect(reachable.rows[0].n).toBe(0);
  });

  it('gives a party the smallest table that fits', async () => {
    await book({ party: 2 });
    const taken = await db.query<{ seats: number }>(
      `select t.seats from bookings b join dining_tables t on t.id = b.table_id`,
    );
    expect(taken.rows[0].seats).toBe(2);
  });

  it('only offers a table in the area asked for', async () => {
    await book({ party: 2, area: 'bar' });
    const taken = await db.query<{ area: string }>(
      `select t.area from bookings b join dining_tables t on t.id = b.table_id`,
    );
    expect(taken.rows[0].area).toBe('bar');
  });

  it('falls back to pending rather than a different area, and remembers what was asked for', async () => {
    // Nothing in the bar seats five — the stools hold one each and the high
    // table holds four — so this has to fall to a human, not silently land
    // somewhere else the guest never chose.
    const result = await book({ party: 5, area: 'bar' });
    expect(result.status).toBe('pending');

    const row = await db.query<{ table_id: string | null; requested_area: string }>(
      `select table_id, requested_area from bookings limit 1`,
    );
    expect(row.rows[0].table_id).toBeNull();
    expect(row.rows[0].requested_area).toBe('bar');
  });

  it('remembers the requested area even when a table was found', async () => {
    await book({ party: 2, area: 'terrace' });
    const row = await db.query<{ requested_area: string }>(
      `select requested_area from bookings limit 1`,
    );
    expect(row.rows[0].requested_area).toBe('terrace');
  });

  it('ignores an area nobody offers rather than failing the booking', async () => {
    // Mirrors how an unrecognised `in_lang` is quietly normalised rather than
    // rejected — a stale client sending 'patio' should not be the reason a
    // guest cannot book at all.
    const result = await book({ party: 2, area: 'patio' });
    expect(result.ok).toBe(true);
    const row = await db.query<{ requested_area: string | null }>(
      `select requested_area from bookings limit 1`,
    );
    expect(row.rows[0].requested_area).toBeNull();
  });
});

describe('free_slots with an area', () => {
  it('only counts tables in the requested area', async () => {
    const slots = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 5, array['19:30']::time[], 'bar')`,
      [DAY],
    );
    // Nothing in the bar seats a party of five.
    expect(slots.rows).toHaveLength(0);
  });

  it('still finds the same slot with no area given', async () => {
    const slots = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 2, array['19:30']::time[], null)`,
      [DAY],
    );
    expect(slots.rows.map((r) => r.slot)).toContain('19:30:00');
  });
});

describe('a scheduled area closure', () => {
  /** Covers `DAY`, the fixed date every other test in this file books against. */
  async function closeArea(area: string) {
    await db.query(
      `insert into area_closures (area, from_date, to_date, reason) values ($1, $2::date, $2::date, 'test')`,
      [area, DAY],
    );
  }

  it('drops a closed area out of free_slots even with no preference given', async () => {
    await closeArea('terrace');
    const withPreference = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 2, array['19:30']::time[], 'terrace')`,
      [DAY],
    );
    expect(withPreference.rows).toHaveLength(0);

    // A guest who asked for nothing in particular must not land on the
    // closed area either — the whole point is that it has stopped existing
    // for this date, not just stopped being offered on request.
    const noPreference = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 2, array['19:30']::time[], null)`,
      [DAY],
    );
    expect(noPreference.rows.map((r) => r.slot)).toContain('19:30:00');
  });

  it('falls back to pending rather than seating a closed area', async () => {
    await closeArea('terrace');
    const result = await book({ party: 2, area: 'terrace' });
    expect(result.status).toBe('pending');
    const row = await db.query<{ table_id: string | null }>(`select table_id from bookings limit 1`);
    expect(row.rows[0].table_id).toBeNull();
  });

  it('leaves other areas bookable', async () => {
    await closeArea('terrace');
    const result = await book({ party: 2, area: 'bar' });
    expect(result.status).toBe('confirmed');
  });

  it('stops applying once reopened', async () => {
    await closeArea('terrace');
    await db.query(`delete from area_closures where area = 'terrace'`);
    const result = await book({ party: 2, area: 'terrace' });
    expect(result.status).toBe('confirmed');
  });
});

describe('the booking throttle', () => {
  /*
   * The rail that exists because the site confirms tables by itself. Without
   * it a script takes the whole diary, and the day's email allowance with it.
   */
  const flood = async (n: number, opts: Parameters<typeof book>[0] = {}) => {
    for (let i = 0; i < n; i++) await book({ email: `flood${i}@example.com`, ...opts });
  };

  it('allows six from one address and refuses the seventh', async () => {
    for (let i = 0; i < 6; i++) expect((await book()).ok).toBe(true);

    const seventh = await book();
    expect(seventh.ok).toBe(false);
    // The code is what the route turns into a 429 rather than a generic
    // failure, so it is part of the contract, not an implementation detail.
    expect(seventh.code).toBe('TN001');
  });

  it('is not fooled by a fresh address each time', async () => {
    await flood(6, { client: 'hash-of-one-ip' });
    expect((await book({ email: 'new@example.com', client: 'hash-of-one-ip' })).code).toBe('TN001');
  });

  it('does not punish everybody else for one flood', async () => {
    await flood(6, { client: 'hash-of-one-ip' });
    expect((await book({ email: 'someone@example.com', client: 'other-ip' })).ok).toBe(true);
  });

  it('still counts by address when no client key is configured', async () => {
    // What running without THROTTLE_SALT looks like: weaker, but not off.
    for (let i = 0; i < 6; i++) await book({ client: null });
    expect((await book({ client: null })).code).toBe('TN001');
    expect((await book({ email: 'different@example.com', client: null })).ok).toBe(true);
  });

  it('treats an address as the same address whatever the capitals', async () => {
    for (let i = 0; i < 6; i++) await book({ email: 'Marieke@Example.com' });
    expect((await book({ email: 'marieke@example.COM' })).code).toBe('TN001');
  });

  it('counts only bookings that happened', async () => {
    await book({ client: 'hash' });
    await book({ client: 'hash', name: '   ' }); // rejected: no name
    const rows = await db.query<{ n: number }>('select count(*)::int as n from booking_throttle');
    expect(rows.rows[0].n).toBe(2); // one address key and one IP key, from the first
  });

  it('forgets an hour later, without anything having to sweep up', async () => {
    await db.exec(`insert into booking_throttle (key, at)
                   select 'email:marieke@example.com', now() - interval '2 hours'
                   from generate_series(1, 20)`);

    expect((await book()).ok).toBe(true);

    // Pruned on the way in, so the table stays the size of the last hour and
    // there is no cron job to forget to set up.
    const left = await db.query<{ n: number }>('select count(*)::int as n from booking_throttle');
    expect(left.rows[0].n).toBe(1);
  });
});

describe('field lengths', () => {
  it('accepts a name at the limit and refuses one character more', async () => {
    expect((await book({ name: 'n'.repeat(80) })).ok).toBe(true);
    expect((await book({ name: 'n'.repeat(81), email: 'other@example.com' })).ok).toBe(false);
  });

  it('accepts a note at the limit and refuses one character more', async () => {
    expect((await book({ note: 'x'.repeat(500) })).ok).toBe(true);
    expect((await book({ note: 'x'.repeat(501), email: 'other@example.com' })).ok).toBe(false);
  });

  it('holds the line at the column too, not only in the function', async () => {
    // `book_table` is not the only way a row can arrive — the admin writes
    // bookings directly. The constraint is what covers that.
    await expect(
      db.exec(`insert into bookings (date, time, party_size, guest_name, guest_email)
               values ('${DAY}', '19:30', 2, '${'z'.repeat(81)}', 'a@example.com')`),
    ).rejects.toThrow(/guest_name_length/);
  });
});

/**
 * Permissions, after 0012 replaced the three roles.
 *
 * The guard is the part worth testing: unticking a box is a quieter way to
 * lock the whole room out than deleting an account, and nothing on screen
 * would warn you before it happened.
 */
describe('permissions', () => {
  async function addStaff(name: string, permissions: string[]) {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    const id = rows[0].id;
    await db.query(`insert into staff (user_id, email, permissions) values ($1, $2, $3)`, [
      id,
      `${name}@staff.ta-nnin.be`,
      permissions,
    ]);
    return id;
  }

  it('has no roles left — not the column, not the type', async () => {
    const col = await db.query(
      `select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'staff' and column_name = 'role'`,
    );
    expect(col.rows).toHaveLength(0);

    const type = await db.query(`select 1 from pg_type where typname = 'staff_role'`);
    expect(type.rows).toHaveLength(0);
  });

  it('refuses a permission that is not one of the six', async () => {
    await expect(addStaff('mallory', ['everything'])).rejects.toThrow(/staff_permissions_check/);
  });

  it('will not let the last person who manages people give it up', async () => {
    await addStaff('sacha', ['people', 'bookings']);
    await expect(
      db.query(`update staff set permissions = array['bookings']`),
    ).rejects.toThrow(/manage people/);
  });

  it('will not let the last one be deleted either', async () => {
    await addStaff('sacha', ['people']);
    await expect(db.query(`delete from staff`)).rejects.toThrow(/manage people/);
  });

  it('allows it once somebody else can manage people', async () => {
    const first = await addStaff('sacha', ['people']);
    await addStaff('tawat', ['people']);
    await db.query(`update staff set permissions = array['bookings'] where user_id = $1`, [first]);

    const left = await db.query<{ n: number }>(
      `select count(*)::int as n from staff where 'people' = any(permissions)`,
    );
    expect(left.rows[0].n).toBe(1);
  });
});

describe('switching somebody off', () => {
  async function addStaff(name: string, permissions: string[], active = true) {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (id) values (gen_random_uuid()) returning id`,
    );
    await db.query(
      `insert into staff (user_id, email, permissions, active) values ($1, $2, $3, $4)`,
      [rows[0].id, `${name}@staff.ta-nnin.be`, permissions, active],
    );
    return rows[0].id;
  }

  it('keeps the row and the login', async () => {
    const id = await addStaff('fred', ['sold_out']);
    await db.query(`update staff set active = false where user_id = $1`, [id]);

    const still = await db.query<{ n: number }>(
      `select count(*)::int as n from staff where user_id = $1`,
      [id],
    );
    expect(still.rows[0].n).toBe(1);
  });

  it('will not let the last person who manages people be switched off', async () => {
    // The same lockout as deleting them, and a much easier tap to make.
    await addStaff('sacha', ['people']);
    await expect(db.query(`update staff set active = false`)).rejects.toThrow(/manage people/);
  });

  it('counts only people who are switched on', async () => {
    await addStaff('sacha', ['people']);
    await addStaff('holiday', ['people'], false);
    // The second holds 'people' but is off, so the first is still the last one.
    await expect(
      db.query(`update staff set active = false where email like 'sacha%'`),
    ).rejects.toThrow(/manage people/);
  });
});

describe('a phone booking taken by staff', () => {
  it('is rejected with no email from a guest', async () => {
    const result = await book({ email: '' });
    expect(result.ok).toBe(false);
  });

  it('is accepted with no email from staff', async () => {
    const result = await asStaff(() => book({ email: '' }));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('confirmed');

    const row = await db.query<{ guest_email: string | null }>(`select guest_email from bookings limit 1`);
    expect(row.rows[0].guest_email).toBeNull();
  });

  it('skips the guest throttle entirely', async () => {
    // The public form's abuse guard is about a stranger hammering the anon
    // key, not a busy phone line — five staff calls back to back should never
    // trip it, where five anonymous ones would (booking-throttle.test.ts
    // covers the guest side of that limit).
    await asStaff(async () => {
      for (let i = 0; i < 6; i++) {
        const result = await book({ email: '', client: null });
        expect(result.ok).toBe(true);
      }
    });
  });
});

describe('a per-day table override', () => {
  async function tableId(name: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(`select id from dining_tables where name = $1`, [name]);
    return rows[0].id;
  }

  it('bumps a table past its normal capacity for just that date', async () => {
    // Window 3 seats two; nothing seats five there normally.
    const before = await book({ party: 5, area: 'bar' });
    expect(before.status).toBe('pending');

    await db.query(
      `insert into table_day_overrides (date, kind, table_id, seats_delta)
       values ($1::date, 'seats_delta', $2, 3)`,
      [DAY, await tableId('Window 3')],
    );

    const after = await book({ party: 5, area: 'bar' });
    expect(after.status).toBe('confirmed');
    const taken = await db.query<{ name: string }>(
      `select t.name from bookings b join dining_tables t on t.id = b.table_id
       where b.id = (select id from bookings order by created_at desc limit 1)`,
    );
    expect(taken.rows[0].name).toBe('Window 3');
  });

  it('does not touch capacity on a different date', async () => {
    const otherDay = new Date(Date.parse(DAY) + 86_400_000).toISOString().slice(0, 10);
    await db.query(
      `insert into table_day_overrides (date, kind, table_id, seats_delta)
       values ($1::date, 'seats_delta', $2, 3)`,
      [DAY, await tableId('Window 3')],
    );
    const slots = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 5, array['19:30']::time[], 'bar')`,
      [otherDay],
    );
    expect(slots.rows).toHaveLength(0);
  });

  it('takes a table out of the pool for just that date, and only that date', async () => {
    await db.query(
      `insert into table_day_overrides (date, kind, table_id)
       values ($1::date, 'closed', $2)`,
      [DAY, await tableId('Counter Bar')],
    );

    const closedDay = await db.query<{ n: number }>(
      `select count(*)::int as n from effective_tables_for($1::date) where id = $2`,
      [DAY, await tableId('Counter Bar')],
    );
    expect(closedDay.rows[0].n).toBe(0);

    const otherDay = new Date(Date.parse(DAY) + 86_400_000).toISOString().slice(0, 10);
    const openDay = await db.query<{ n: number }>(
      `select count(*)::int as n from effective_tables_for($1::date) where id = $2`,
      [otherDay, await tableId('Counter Bar')],
    );
    expect(openDay.rows[0].n).toBe(1);
  });

  // book_table caps every party at 8 regardless of caller — a pre-existing
  // limit, not something these overrides change — so a large private-event
  // table still needs a party size within that range to actually be reachable
  // through it. Sized at 5, which nothing already in the bar seats (the
  // biggest real bar tables hold 4), so it is always the unique fit.
  it('lets a one-night ad-hoc table be booked', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into table_day_overrides (date, kind, name, seats, min_seats, area)
       values ($1::date, 'adhoc', 'Private event table', 5, 2, 'bar')
       returning id`,
      [DAY],
    );

    const result = await book({ party: 5, area: 'bar' });
    expect(result.status).toBe('confirmed');

    const row = await db.query<{ table_id: string | null; day_override_table_id: string | null }>(
      `select table_id, day_override_table_id from bookings limit 1`,
    );
    expect(row.rows[0].table_id).toBeNull();
    expect(row.rows[0].day_override_table_id).toBe(rows[0].id);
  });

  it('never offers the ad-hoc table on a night it was not added for', async () => {
    await db.query(
      `insert into table_day_overrides (date, kind, name, seats, min_seats, area)
       values ($1::date, 'adhoc', 'Private event table', 5, 2, 'bar')`,
      [DAY],
    );
    const otherDay = new Date(Date.parse(DAY) + 86_400_000).toISOString().slice(0, 10);
    const slots = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 5, array['19:30']::time[], 'bar')`,
      [otherDay],
    );
    expect(slots.rows).toHaveLength(0);
  });

  it('frees the ad-hoc table once its own booking is cancelled', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into table_day_overrides (date, kind, name, seats, min_seats, area)
       values ($1::date, 'adhoc', 'Private event table', 5, 2, 'bar')
       returning id`,
      [DAY],
    );
    const first = await book({ party: 5, area: 'bar' });
    expect(first.status).toBe('confirmed');

    const second = await book({ party: 5, area: 'bar', email: 'second@example.com' });
    // The one adhoc table is taken and the largest real bar table seats four
    // — falls to pending rather than landing somewhere the guest never chose.
    expect(second.status).toBe('pending');

    await db.query(`update bookings set status = 'cancelled' where day_override_table_id = $1`, [rows[0].id]);
    const third = await book({ party: 5, area: 'bar', email: 'third@example.com' });
    expect(third.status).toBe('confirmed');
  });
});

describe('deleting a table', () => {
  /** A throwaway table, never one from the real seed — deleting it must not touch the plan every other test relies on. */
  async function addTempTable(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into dining_tables (name, seats, min_seats, area, active, position)
       values ('Temp test table', 2, 2, 'inside', true, 999) returning id`,
    );
    return rows[0].id;
  }

  it('goes cleanly when nothing points at it', async () => {
    const id = await addTempTable();
    await expect(db.query(`delete from dining_tables where id = $1`, [id])).resolves.toBeDefined();
  });

  it('takes its seats_delta override with it', async () => {
    const id = await addTempTable();
    await db.query(
      `insert into table_day_overrides (date, kind, table_id, seats_delta) values ($1::date, 'seats_delta', $2, 1)`,
      [DAY, id],
    );
    await db.query(`delete from dining_tables where id = $1`, [id]);
    const left = await db.query<{ n: number }>(`select count(*)::int as n from table_day_overrides where table_id = $1`, [id]);
    expect(left.rows[0].n).toBe(0);
  });

  it('survives on a booking, unassigned rather than the delete being refused', async () => {
    const id = await addTempTable();
    const { rows } = await db.query<{ id: string }>(
      `insert into bookings (date, time, party_size, guest_name, guest_email, status, table_id)
       values ($1::date, '19:30', 2, 'Temp Guest', 'temp@example.com', 'confirmed', $2) returning id`,
      [DAY, id],
    );
    await db.query(`delete from dining_tables where id = $1`, [id]);
    const after = await db.query<{ status: string; table_id: string | null }>(
      `select status, table_id from bookings where id = $1`,
      [rows[0].id],
    );
    expect(after.rows[0].status).toBe('confirmed');
    expect(after.rows[0].table_id).toBeNull();
  });
});

describe('reservation and cancellation codes', () => {
  it('gives every booking a reservation code on creation', async () => {
    await book({ party: 2 });
    const row = await db.query<{ ref_code: string }>(`select ref_code from bookings limit 1`);
    expect(row.rows[0].ref_code).toMatch(/^TN-\d+$/);
  });

  it('mints a cancellation code the moment a booking is cancelled', async () => {
    await book({ party: 2 });
    const before = await db.query<{ cancel_code: string | null }>(
      `select cancel_code from bookings limit 1`,
    );
    expect(before.rows[0].cancel_code).toBeNull();

    await db.query(`update bookings set status = 'cancelled'`);
    const after = await db.query<{ status: string; cancel_code: string | null }>(
      `select status, cancel_code from bookings limit 1`,
    );
    expect(after.rows[0].status).toBe('cancelled');
    expect(after.rows[0].cancel_code).toMatch(/^TN-C-\d+$/);
  });

  it('keeps the first cancellation code if reinstated and cancelled again', async () => {
    // The number a guest was told has to stay the number on the row.
    await book({ party: 2 });
    await db.query(`update bookings set status = 'cancelled'`);
    const first = await db.query<{ cancel_code: string }>(`select cancel_code from bookings limit 1`);
    await db.query(`update bookings set status = 'confirmed'`);
    await db.query(`update bookings set status = 'cancelled'`);
    const again = await db.query<{ cancel_code: string }>(`select cancel_code from bookings limit 1`);
    expect(again.rows[0].cancel_code).toBe(first.rows[0].cancel_code);
  });

  it('hands back the reservation code for a manage token, and nothing else', async () => {
    await book({ party: 2 });
    const row = await db.query<{ manage_token: string; ref_code: string }>(
      `select manage_token, ref_code from bookings limit 1`,
    );
    const fn = await db.query<{ booking_ref_by_token: string }>(
      `select booking_ref_by_token($1::uuid)`,
      [row.rows[0].manage_token],
    );
    expect(fn.rows[0].booking_ref_by_token).toBe(row.rows[0].ref_code);
  });
});

describe('a shared table splits seats between independent parties', () => {
  async function longTableId(): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from dining_tables where name = 'Long table'`);
    return row.rows[0].id;
  }

  it('seats a second, unrelated party at the same shared table instead of going exclusive', async () => {
    // 'inside' has no single non-shared table with 3+ seats, so this only
    // succeeds at all if the Long table is genuinely still open to somebody
    // else once it already holds a booking.
    const a = await book({ party: 3, area: 'inside', email: 'a@example.com' });
    const b = await book({ party: 4, area: 'inside', email: 'b@example.com' });
    expect(a.status).toBe('confirmed');
    expect(b.status).toBe('confirmed');

    const rows = await db.query<{ table_id: string }>(`select table_id from bookings order by created_at`);
    expect(rows.rows).toHaveLength(2);
    const longId = await longTableId();
    expect(rows.rows[0].table_id).toBe(longId);
    expect(rows.rows[1].table_id).toBe(longId);
  });

  it('stops handing out seats once the shared table is full, and does not overshoot', async () => {
    const longId = await longTableId();

    const first = await book({ party: 8, area: 'inside', email: 'a@example.com' });
    const second = await book({ party: 6, area: 'inside', email: 'b@example.com' });
    expect(first.status).toBe('confirmed');
    expect(second.status).toBe('confirmed'); // 8 + 6 = 14, exactly the table's seats.

    // A party of 5 now has somewhere to go — three of the back two-tops
    // combine to seat it — but the full Long table must not be pulled in over
    // its capacity: it still holds exactly its two parties.
    const third = await book({ party: 5, area: 'inside', email: 'c@example.com' });
    expect(third.status).toBe('confirmed');

    const thirdRow = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    expect(thirdRow.rows[0].table_id).not.toBe(longId);
    expect(thirdRow.rows[0].joined_table_ids).not.toContain(longId);

    const seated = await db.query<{ id: string }>(
      `select id from bookings where table_id = $1 and status = 'confirmed'`,
      [longId],
    );
    expect(seated.rows).toHaveLength(2);
  });

  it('still requires party size 2+, same as any other table there', async () => {
    // min_seats is 2 on every 'inside' table, Long table included — a party
    // of 1 has never fit there and sharing (or a two-table combo) must not
    // manufacture an exception to that floor.
    const solo = await book({ party: 1, area: 'inside', email: 'solo@example.com' });
    expect(solo.status).toBe('pending');
  });

  it('lets free_slots see the room a shared table still has, not just whether it holds a booking', async () => {
    await book({ party: 3, area: 'inside', email: 'a@example.com' });

    const stillRoom = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 4, array['19:30'::time], 'inside')`,
      [DAY],
    );
    expect(stillRoom.rows).toHaveLength(1);

    await book({ party: 11, area: 'inside', email: 'b@example.com' }); // 3 + 11 = 14, full.

    const stillFree = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 2, array['19:30'::time], 'inside')`,
      [DAY],
    );
    // The Long table is now full, but every 'inside' two-top is untouched —
    // a party of 2 has plenty of room, just not there.
    expect(stillFree.rows).toHaveLength(1);
  });
});

describe('joining two smaller tables for a party too big for either', () => {
  async function tableId(name: string): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from dining_tables where name = $1`, [name]);
    return row.rows[0].id;
  }

  /**
   * The 'inside' → 'back' connect_group has four equal two-seat tables, not
   * a single fixed pair — combo_tables_for's tie-break picks whichever pair
   * has the smallest positions, so this reads the seed the same way rather
   * than hardcoding which two names that happens to be.
   */
  async function expectedBackPair(): Promise<[string, string]> {
    const rows = await db.query<{ id: string }>(
      `select id from dining_tables where connect_group = 'back' and area = 'inside' order by position asc limit 2`,
    );
    return [rows.rows[0].id, rows.rows[1].id];
  }

  it('books both tables of a connect_group pair to the one party once nothing single fits', async () => {
    const longId = await tableId('Long table');
    // Fill the Long table so it can no longer take the single-table search —
    // 'inside' otherwise has nothing but 2-seat exclusive tables, so this is
    // the only way to force a party of 4 there past the single-table search.
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' });

    const [expectedA, expectedB] = await expectedBackPair();

    const combo = await book({ party: 4, area: 'inside', email: 'c@example.com' });
    expect(combo.status).toBe('confirmed');

    const row = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    const { table_id, joined_table_ids } = row.rows[0];
    expect(table_id).not.toBe(longId);
    expect(joined_table_ids).toHaveLength(1);
    expect([table_id, ...joined_table_ids].sort()).toEqual([expectedA, expectedB].sort());
  });

  it('does not reach for a combo when a single table already fits', async () => {
    // A party of 2 has plenty of single exclusive 'inside' two-tops free —
    // joining two tables for it would waste a table for nothing.
    const result = await book({ party: 2, area: 'inside', email: 'a@example.com' });
    expect(result.status).toBe('confirmed');

    const row = await db.query<{ joined_table_ids: string[] }>(
      `select joined_table_ids from bookings limit 1`,
    );
    expect(row.rows[0].joined_table_ids).toEqual([]);
  });

  it('will not join a shared table into a combo — its spare seats are offered on their own', async () => {
    // The 'street' connect_group mixes an is_shared six-top with three
    // exclusive two-tops. A party that does not fit any single terrace table
    // must only ever be paired across the exclusive members.
    const longId = await tableId('Long table');
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' });
    await book({ party: 4, area: 'inside', email: 'c@example.com' }); // takes the back-group combo

    const combo = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    expect(combo.rows[0].table_id).not.toBe(longId);
    expect(combo.rows[0].joined_table_ids).not.toContain(longId);
  });

  it('leaves a combo pair fully booked — neither table has room left for anybody else', async () => {
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' });
    await book({ party: 4, area: 'inside', email: 'c@example.com' });

    const [backA, backB] = await expectedBackPair();
    const room = await db.query<{ ok: boolean }>(
      `select table_has_room($1::uuid, null, 2, false, $2::date, '19:30'::time, 1) as ok
       union all
       select table_has_room($3::uuid, null, 2, false, $2::date, '19:30'::time, 1)`,
      [backA, DAY, backB],
    );
    expect(room.rows.map((r) => r.ok)).toEqual([false, false]);
  });

  it('goes pending when a party is too big for every single table and every combo', async () => {
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' }); // Long table now full.

    // The back group's four two-tops are inside's only combinable run; a party
    // of 8 takes all four, so nothing combinable is left for anyone after.
    const eight = await book({ party: 8, area: 'inside', email: 'c@example.com' });
    expect(eight.status).toBe('confirmed');

    const tooBig = await book({ party: 5, area: 'inside', email: 'd@example.com' });
    expect(tooBig.status).toBe('pending');

    const row = await db.query<{ table_id: string | null; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'd@example.com'`,
    );
    expect(row.rows[0].table_id).toBeNull();
    expect(row.rows[0].joined_table_ids).toEqual([]);
  });

  it('lets free_slots see combo-only availability, not just single-table fits', async () => {
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' }); // Long table full.

    // A party of 8 fits inside now only by combining all four back two-tops.
    const viaCombo = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 8, array['19:30'::time], 'inside')`,
      [DAY],
    );
    expect(viaCombo.rows).toHaveLength(1);

    // Book that whole run away, and nothing inside can seat a party of 5.
    await book({ party: 8, area: 'inside', email: 'c@example.com' });
    const tooBigForAnything = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 5, array['19:30'::time], 'inside')`,
      [DAY],
    );
    expect(tooBigForAnything.rows).toHaveLength(0);
  });
});

describe('joining a completely empty shared table into a combo for an oversized party', () => {
  async function tableId(name: string): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from dining_tables where name = $1`, [name]);
    return row.rows[0].id;
  }

  it('combines an empty shared table with a neighbor when nothing exclusive-only reaches the party', async () => {
    // The terrace's only route past 6 seats: its shared street six-top plus
    // one of its joined two-tops. No purely exclusive terrace combo reaches
    // past 4 seats, so this only succeeds if a shared table can be annexed.
    const sixTop = await tableId('Terrace — street 6');
    const result = await book({ party: 8, area: 'terrace', email: 'a@example.com' });
    expect(result.status).toBe('confirmed');

    const row = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'a@example.com'`,
    );
    const { table_id, joined_table_ids } = row.rows[0];
    expect(joined_table_ids.length).toBeGreaterThan(0);
    expect([table_id, ...joined_table_ids]).toContain(sixTop);
  });

  it('will not annex a shared table that already holds anybody, however small', async () => {
    // A party of 5 is exactly large enough that only the two shared six-tops
    // qualify, and the street one wins on position — landing there without
    // needing anything else pre-booked.
    const first = await book({ party: 5, area: 'terrace', email: 'first@example.com' });
    expect(first.status).toBe('confirmed');
    const sixTop = await tableId('Terrace — street 6');
    const seated = await db.query<{ table_id: string }>(
      `select table_id from bookings where guest_email = 'first@example.com'`,
    );
    expect(seated.rows[0].table_id).toBe(sixTop);

    // It is no longer empty, so a party of 8 must not be handed it as part
    // of a combo, even though 5 + 8 would never have fit anyway.
    const result = await book({ party: 8, area: 'terrace', email: 'second@example.com' });
    expect(result.status).toBe('pending');
  });

  it('leaves the annexed shared table with no room for anybody once the combo is booked', async () => {
    const sixTop = await tableId('Terrace — street 6');
    await book({ party: 8, area: 'terrace', email: 'a@example.com' });

    const room = await db.query<{ ok: boolean }>(
      `select table_has_room($1::uuid, null, 6, true, $2::date, '19:30'::time, 1) as ok`,
      [sixTop, DAY],
    );
    expect(room.rows[0].ok).toBe(false);
  });

  it('prefers an all-exclusive combo over annexing a shared table when both would do', async () => {
    // Nothing in the current floor plan actually ties on total seats between
    // an all-exclusive combo and one that uses a shared table (the only
    // combos reaching a shared table's seats are the six-top pairings at 8;
    // exclusive-only pairs cap at 4) — this checks the tie-break exists and
    // does not accidentally reach for a shared table when smaller,
    // sufficient exclusive combos exist for a party they can serve.
    const combo = await db.query<{ table_ids: string[] }>(
      `select table_ids from combo_tables_for($1::date, '19:30'::time, 4, 'terrace')`,
      [DAY],
    );
    const sixTop = await tableId('Terrace — street 6');
    const frontSix = await tableId('Terrace — front 6');
    expect(combo.rows[0].table_ids).not.toContain(sixTop);
    expect(combo.rows[0].table_ids).not.toContain(frontSix);
  });

  it('does not disturb the inside back-group combo, which has no shared table to annex', async () => {
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' });
    const combo = await book({ party: 4, area: 'inside', email: 'c@example.com' });
    expect(combo.status).toBe('confirmed');

    const longId = await tableId('Long table');
    const row = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    expect(row.rows[0].table_id).not.toBe(longId);
    expect(row.rows[0].joined_table_ids).not.toContain(longId);
  });
});

describe('joining more than two tables for one big party', () => {
  async function tableId(name: string): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from dining_tables where name = $1`, [name]);
    return row.rows[0].id;
  }

  it('seats a party of eight across all four back two-tops when nothing smaller fits', async () => {
    // 'inside' past the Long table is four exclusive two-tops in one run —
    // eight only fits by pushing all four together.
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' }); // Long table full.

    const eight = await book({ party: 8, area: 'inside', email: 'c@example.com' });
    expect(eight.status).toBe('confirmed');

    const row = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    const run = [row.rows[0].table_id, ...row.rows[0].joined_table_ids].sort();
    const back = await db.query<{ id: string }>(
      `select id from dining_tables where connect_group = 'back' and area = 'inside'`,
    );
    expect(run).toEqual(back.rows.map((r) => r.id).sort());
  });

  it('takes the biggest free pieces first — a six-top plus one two-top for a party of eight', async () => {
    // The terrace street run is a shared six-top and three exclusive two-tops.
    // Eight should come out as 6 + 2, not four twos.
    const result = await book({ party: 8, area: 'terrace', email: 'a@example.com' });
    expect(result.status).toBe('confirmed');

    const sixTop = await tableId('Terrace — street 6');
    const row = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'a@example.com'`,
    );
    const run = [row.rows[0].table_id, ...row.rows[0].joined_table_ids];
    expect(run).toHaveLength(2);
    expect(run).toContain(sixTop);
  });

  it('never mixes heights in one run', async () => {
    // Whatever run it picks for a party no single terrace table fits, every
    // table in it must share is_high — you cannot push a bar-height table
    // against a low one.
    const combo = await db.query<{ table_ids: string[] }>(
      `select table_ids from combo_tables_for($1::date, '19:30'::time, 8, 'terrace')`,
      [DAY],
    );
    const heights = await db.query<{ is_high: boolean }>(
      `select distinct is_high from dining_tables where id = any($1::uuid[])`,
      [combo.rows[0].table_ids],
    );
    expect(heights.rows).toHaveLength(1);
  });

  it('takes a removed table back out of every run it was part of', async () => {
    // The array has no per-element foreign key; the delete-time trigger stands
    // in for the old ON DELETE SET NULL.
    await book({ party: 8, area: 'inside', email: 'a@example.com' });
    await book({ party: 6, area: 'inside', email: 'b@example.com' });
    await book({ party: 8, area: 'inside', email: 'c@example.com' }); // the four-back run

    const row = await db.query<{ table_id: string; joined_table_ids: string[] }>(
      `select table_id, joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    const dropped = row.rows[0].joined_table_ids[0];
    await db.query(`delete from dining_tables where id = $1`, [dropped]);

    const after = await db.query<{ joined_table_ids: string[] }>(
      `select joined_table_ids from bookings where guest_email = 'c@example.com'`,
    );
    expect(after.rows[0].joined_table_ids).not.toContain(dropped);
  });
});

describe('rescheduling an existing booking', () => {
  async function onlyId(): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from bookings limit 1`);
    return row.rows[0].id;
  }

  it('moves a booking to a new time without it blocking itself', async () => {
    // The same 2-top is free at both times; the move must not read the booking's
    // own 19:00 hold as occupying 19:30.
    await book({ party: 2, area: 'inside', time: '19:00' });
    const id = await onlyId();

    await asStaff(async () => {
      const r = await db.query<{ reschedule_booking: string }>(
        `select reschedule_booking($1::uuid, $2::date, '19:30'::time, 2, 'inside')`,
        [id, DAY],
      );
      expect(r.rows[0].reschedule_booking).toBe('confirmed');
    });

    const after = await db.query<{ time: string; status: string; table_id: string | null }>(
      `select time, status, table_id from bookings where id = $1`,
      [id],
    );
    expect(after.rows[0].time).toBe('19:30:00');
    expect(after.rows[0].status).toBe('confirmed');
    expect(after.rows[0].table_id).not.toBeNull();
  });

  it('re-fits a grown party onto the shared long table', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    const longId = (await db.query<{ id: string }>(`select id from dining_tables where name = 'Long table'`))
      .rows[0].id;

    await asStaff(async () => {
      const r = await db.query<{ reschedule_booking: string }>(
        `select reschedule_booking($1::uuid, $2::date, '19:30'::time, 8, 'inside')`,
        [id, DAY],
      );
      expect(r.rows[0].reschedule_booking).toBe('confirmed');
    });

    const after = await db.query<{ party_size: number; table_id: string }>(
      `select party_size, table_id from bookings where id = $1`,
      [id],
    );
    expect(after.rows[0].party_size).toBe(8);
    expect(after.rows[0].table_id).toBe(longId);
  });

  it('comes back pending and tableless when nothing fits the new shape', async () => {
    await book({ party: 2, area: 'bar' });
    const id = await onlyId();

    await asStaff(async () => {
      const r = await db.query<{ reschedule_booking: string }>(
        `select reschedule_booking($1::uuid, $2::date, '19:30'::time, 8, 'bar')`,
        [id, DAY],
      );
      expect(r.rows[0].reschedule_booking).toBe('pending');
    });

    const after = await db.query<{ status: string; table_id: string | null; joined_table_ids: string[] }>(
      `select status, table_id, joined_table_ids from bookings where id = $1`,
      [id],
    );
    expect(after.rows[0].status).toBe('pending');
    expect(after.rows[0].table_id).toBeNull();
    expect(after.rows[0].joined_table_ids).toEqual([]);
  });

  it('refuses to move a booking that is no longer upcoming', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    await db.query(`update bookings set status = 'seated' where id = $1`, [id]);

    await asStaff(async () => {
      await expect(
        db.query(`select reschedule_booking($1::uuid, $2::date, '20:00'::time, 2, 'inside')`, [id, DAY]),
      ).rejects.toThrow(/upcoming/);
    });
  });

  it('is staff only', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    // No asStaff wrapper: auth.uid() is null, so is_staff() is false.
    await expect(
      db.query(`select reschedule_booking($1::uuid, $2::date, '20:00'::time, 2, 'inside')`, [id, DAY]),
    ).rejects.toThrow(/staff only/);
  });
});

describe('assign_booking_seats — the manual reseat path staff use, re-validated server-side', () => {
  async function onlyId(): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from bookings limit 1`);
    return row.rows[0].id;
  }

  async function tableId(name: string): Promise<string> {
    const row = await db.query<{ id: string }>(`select id from dining_tables where name = $1`, [name]);
    return row.rows[0].id;
  }

  it('is staff only', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    const t = await tableId('Long table');
    await expect(
      db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [id, t]),
    ).rejects.toThrow(/staff only/);
  });

  it('seats a pending request onto a free table by hand', async () => {
    const pending = await book({ party: 5, area: 'bar' }); // nothing in the bar seats 5
    expect(pending.status).toBe('pending');
    const id = await onlyId();
    const t = await tableId('Counter Bar');

    await asStaff(() => db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [id, t]));

    const row = await db.query<{ table_id: string }>(`select table_id from bookings where id = $1`, [id]);
    expect(row.rows[0].table_id).toBe(t);
  });

  it('refuses to double-book a table two different staff members confirm onto it at once', async () => {
    const a = await book({ party: 2, area: 'inside', email: 'a@example.com' });
    const b = await book({ party: 2, area: 'inside', email: 'b@example.com' });
    const aId = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'a@example.com'`))
      .rows[0].id;
    const bId = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'b@example.com'`))
      .rows[0].id;
    const t = await tableId('Window 3'); // an exclusive two-top

    await asStaff(() => db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [aId, t]));
    await asStaff(async () => {
      await expect(
        db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [bId, t]),
      ).rejects.toThrow(/not free/);
    });
    void a;
    void b;
  });

  it('does not read a booking as blocking the very table it already holds', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    const t = await tableId('Window 3');
    await asStaff(() => db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [id, t]));
    // Reassigning it to the same table it is already on must not trip the
    // overlap check against itself.
    await asStaff(() => db.query(`select assign_booking_seats($1::uuid, $2::uuid, $3::int[])`, [id, t, [0, 1]]));
    const row = await db.query<{ table_id: string; seat_indices: number[] }>(
      `select table_id, seat_indices from bookings where id = $1`,
      [id],
    );
    expect(row.rows[0].table_id).toBe(t);
    expect(row.rows[0].seat_indices).toEqual([0, 1]);
  });

  it('refuses a table closed for the night, even though the client sent it', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    const t = await tableId('Window 3');
    await db.query(
      `insert into table_day_overrides (date, kind, table_id) values ($1::date, 'closed', $2)`,
      [DAY, t],
    );
    await asStaff(async () => {
      await expect(
        db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [id, t]),
      ).rejects.toThrow(/not available/);
    });
  });

  it('clears the seating when the table id is null', async () => {
    await book({ party: 2, area: 'inside' });
    const id = await onlyId();
    const t = await tableId('Window 3');
    await asStaff(async () => {
      await db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [id, t]);
      await db.query(`select assign_booking_seats($1::uuid, null)`, [id]);
    });
    const row = await db.query<{ table_id: string | null }>(`select table_id from bookings where id = $1`, [id]);
    expect(row.rows[0].table_id).toBeNull();
  });

  it('only joins a second table when it is entirely free, same as a manual join in the seat picker', async () => {
    const [a, b] = await expectedBackPair();
    // Occupy table b with somebody else first.
    await book({ party: 2, area: 'inside', email: 'other@example.com' });
    const otherId = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'other@example.com'`))
      .rows[0].id;
    await asStaff(() => db.query(`select assign_booking_seats($1::uuid, $2::uuid)`, [otherId, b]));

    await book({ party: 4, area: 'inside', email: 'party@example.com' });
    const partyId = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'party@example.com'`))
      .rows[0].id;

    await asStaff(async () => {
      await expect(
        db.query(`select assign_booking_seats($1::uuid, $2::uuid, null, $3::uuid[])`, [partyId, a, [b]]),
      ).rejects.toThrow(/joined table.*not free/);
    });
  });

  async function expectedBackPair(): Promise<[string, string]> {
    const rows = await db.query<{ id: string }>(
      `select id from dining_tables where connect_group = 'back' and area = 'inside' order by position asc limit 2`,
    );
    return [rows.rows[0].id, rows.rows[1].id];
  }
});

describe('pacing, turn times, and the reset buffer', () => {
  async function setSettings(patch: Record<string, number | null>): Promise<void> {
    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await db.query(`update booking_settings set ${sets}`, cols.map((c) => patch[c]));
  }

  it('leaves everything unchanged at the default settings', async () => {
    // Two inside parties an hour apart still both fit — the refactor and the
    // new columns must not move the baseline.
    const a = await book({ party: 2, area: 'inside', time: '18:00' });
    const b = await book({ party: 2, area: 'inside', time: '20:00', email: 'b@example.com' });
    expect(a.status).toBe('confirmed');
    expect(b.status).toBe('confirmed');
  });

  it('caps covers arriving in the same 15-minute window once pacing is set', async () => {
    await setSettings({ pace_covers: 6 });
    const first = await book({ party: 4, area: 'inside', time: '19:00', email: 'a@example.com' });
    expect(first.status).toBe('confirmed');
    // 4 + 4 = 8 > 6 in the 19:00–19:15 window: nothing free, however many tables.
    const second = await book({ party: 4, area: 'inside', time: '19:05', email: 'b@example.com' });
    expect(second.status).toBe('pending');
    // A different window is unaffected.
    const later = await book({ party: 4, area: 'inside', time: '19:30', email: 'c@example.com' });
    expect(later.status).toBe('confirmed');
  });

  it('free_slots respects the pacing cap too, so the picker cannot offer a paced-out slot', async () => {
    await setSettings({ pace_covers: 4 });
    await book({ party: 4, area: 'inside', time: '19:00', email: 'a@example.com' });
    const slots = await db.query<{ slot: string }>(
      `select * from free_slots($1::date, 2, array['19:00'::time, '19:45'::time], 'inside')`,
      [DAY],
    );
    // 19:00 is full to the cap; 19:45 is a fresh window.
    expect(slots.rows.map((r) => r.slot)).toEqual(['19:45:00']);
  });

  it('holds a big party longer than a small one once a large turn is set', async () => {
    // Base 105, large 180 from party 5 up. A 6-top at 18:00 blocks its table
    // until 21:00; a 2-top at 20:30 would fit under the 105 turn but not the 180.
    await setSettings({ turn_minutes: 105, turn_minutes_large: 180, large_party_threshold: 5 });
    const big = await book({ party: 6, area: 'inside', time: '18:00', email: 'a@example.com' });
    expect(big.status).toBe('confirmed');
    const bigId = (await db.query<{ table_id: string }>(
      `select table_id from bookings where guest_email = 'a@example.com'`,
    )).rows[0].table_id;

    // A second party forced onto the same table: fill every other inside option
    // is hard, so instead check table_has_room directly for that table.
    const roomAt2030 = await db.query<{ ok: boolean }>(
      `select table_has_room($1::uuid, null, 6, false, $2::date, '20:30'::time, 2) as ok`,
      [bigId, DAY],
    );
    expect(roomAt2030.rows[0].ok).toBe(false); // 18:00 + 180 = 21:00 still overlaps 20:30
    const roomAt2115 = await db.query<{ ok: boolean }>(
      `select table_has_room($1::uuid, null, 6, false, $2::date, '21:15'::time, 2) as ok`,
      [bigId, DAY],
    );
    expect(roomAt2115.rows[0].ok).toBe(true); // past the big turn
  });

  it('keeps a table out of use for the reset buffer after a booking', async () => {
    await setSettings({ turn_minutes: 105, buffer_minutes: 15 });
    const first = await book({ party: 2, area: 'inside', time: '18:00', email: 'a@example.com' });
    const tableId = (await db.query<{ table_id: string }>(
      `select table_id from bookings where guest_email = 'a@example.com'`,
    )).rows[0].table_id;
    expect(first.status).toBe('confirmed');

    // 18:00 + 105 = 19:45; with a 15-minute buffer the table is not free until 20:00.
    const at1945 = await db.query<{ ok: boolean }>(
      `select table_has_room($1::uuid, null, 2, false, $2::date, '19:45'::time, 2) as ok`,
      [tableId, DAY],
    );
    expect(at1945.rows[0].ok).toBe(false);
    const at2000 = await db.query<{ ok: boolean }>(
      `select table_has_room($1::uuid, null, 2, false, $2::date, '20:00'::time, 2) as ok`,
      [tableId, DAY],
    );
    expect(at2000.rows[0].ok).toBe(true);
  });

  it('does not count the booking being moved against its own pacing window', async () => {
    await setSettings({ pace_covers: 4 });
    await book({ party: 4, area: 'inside', time: '19:00', email: 'a@example.com' });
    const id = (await db.query<{ id: string }>(`select id from bookings limit 1`)).rows[0].id;
    // Move it within the same 19:00 window: it must not read its own 4 covers as
    // blocking, or a booking could never be nudged inside its window.
    await asStaff(async () => {
      const r = await db.query<{ reschedule_booking: string }>(
        `select reschedule_booking($1::uuid, $2::date, '19:10'::time, 4, 'inside')`,
        [id, DAY],
      );
      expect(r.rows[0].reschedule_booking).toBe('confirmed');
    });
  });
});

describe('a shared note for the day', () => {
  it('stamps who set it and when, without the caller passing either', async () => {
    await asStaff(async () => {
      await db.query(`insert into day_notes (date, note) values ($1::date, 'Chef running late')`, [DAY]);
    });
    const row = await db.query<{ note: string; updated_by: string | null; updated_at: string }>(
      `select note, updated_by, updated_at from day_notes where date = $1::date`,
      [DAY],
    );
    expect(row.rows[0].note).toBe('Chef running late');
    expect(row.rows[0].updated_by).not.toBeNull();
    expect(row.rows[0].updated_at).not.toBeNull();
  });

  it('restamps updated_at on a later edit', async () => {
    await asStaff(async () => {
      await db.query(`insert into day_notes (date, note) values ($1::date, 'First note')`, [DAY]);
    });
    const first = (
      await db.query<{ updated_at: string }>(`select updated_at from day_notes where date = $1::date`, [DAY])
    ).rows[0].updated_at;

    await asStaff(async () => {
      await db.query(`update day_notes set note = 'Revised note' where date = $1::date`, [DAY]);
    });
    const second = await db.query<{ note: string; updated_at: string }>(
      `select note, updated_at from day_notes where date = $1::date`,
      [DAY],
    );
    expect(second.rows[0].note).toBe('Revised note');
    expect(new Date(second.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(first).getTime());
  });
});

describe('booking change history', () => {
  it('logs a status change with the old and new value, attributed to the staff member', async () => {
    await book({ party: 2, area: 'inside', email: 'a@example.com' });
    const id = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'a@example.com'`))
      .rows[0].id;

    await asStaff(async () => {
      await db.query(`update bookings set status = 'seated' where id = $1::uuid`, [id]);
    });

    const rows = await db.query<{
      changed_by: string | null;
      changes: { status: { old: string; new: string } };
    }>(`select changed_by, changes from booking_changes where booking_id = $1::uuid`, [id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].changed_by).not.toBeNull();
    expect(rows.rows[0].changes.status).toEqual({ old: 'confirmed', new: 'seated' });
  });

  it('does not log a contact-detail-only edit — name, phone, e-mail and notes are not "the room changed"', async () => {
    await book({ party: 2, area: 'inside', email: 'a@example.com' });
    const id = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'a@example.com'`))
      .rows[0].id;

    await asStaff(async () => {
      await db.query(`update bookings set guest_name = 'A Different Name' where id = $1::uuid`, [id]);
    });

    const rows = await db.query(`select 1 from booking_changes where booking_id = $1::uuid`, [id]);
    expect(rows.rows).toHaveLength(0);
  });

  it('logs every field changed in one update as a single row, not one row per field', async () => {
    await book({ party: 2, area: 'inside', email: 'a@example.com' });
    const id = (await db.query<{ id: string }>(`select id from bookings where guest_email = 'a@example.com'`))
      .rows[0].id;

    await asStaff(async () => {
      await db.query(`update bookings set party_size = 4, status = 'seated' where id = $1::uuid`, [id]);
    });

    const rows = await db.query<{ changes: Record<string, unknown> }>(
      `select changes from booking_changes where booking_id = $1::uuid`,
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(Object.keys(rows.rows[0].changes).sort()).toEqual(['party_size', 'status']);
  });

  it('logs a guest-made change with no staff attribution', async () => {
    const result = await book({ party: 2, area: 'inside', email: 'a@example.com' });
    expect(result.status).toBe('confirmed');
    const row = await db.query<{ id: string; manage_token: string }>(
      `select id, manage_token from bookings where guest_email = 'a@example.com'`,
    );
    const { id, manage_token } = row.rows[0];

    await db.query(`select cancel_booking_by_token($1::uuid)`, [manage_token]);

    const changes = await db.query<{ changed_by: string | null; changes: Record<string, unknown> }>(
      `select changed_by, changes from booking_changes where booking_id = $1::uuid`,
      [id],
    );
    expect(changes.rows).toHaveLength(1);
    expect(changes.rows[0].changed_by).toBeNull();
    expect(changes.rows[0].changes.status).toEqual({ old: 'confirmed', new: 'cancelled' });
  });
});

describe('an event Instagram source (0042)', () => {
  /*
   * The source_account check constraint is exactly the kind of thing the
   * TypeScript union cannot enforce at the database — a bad value only fails
   * here, so this is where it is proven.
   */
  it('accepts a known account, and no account', async () => {
    await db.exec(`
      insert into events (slug, title, source_url, source_account) values
        ('ev-tannin', 'A', 'https://www.instagram.com/p/x/', 'tannin'),
        ('ev-cellar', 'B', 'https://www.instagram.com/p/y/', 'cellar'),
        ('ev-none',   'C', null, null);
    `);
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from events where slug like 'ev-%'`,
    );
    expect(rows[0].n).toBe(3);
  });

  it('refuses an unknown account', async () => {
    await expect(
      db.exec(`insert into events (slug, title, source_account) values ('ev-bad', 'D', 'facebook')`),
    ).rejects.toThrow();
  });
});

describe('gift vouchers (0053)', () => {
  beforeEach(async () => {
    await db.exec(`delete from gift_vouchers;`);
  });

  const VOUCHERS = ['vouchers'];

  /** A paid online voucher, the way the website makes one. */
  async function paidOnline(amount = 5000) {
    const { rows } = await db.query<{ id: string }>(
      `insert into gift_vouchers (amount_cents, balance_cents, source, recipient_name, from_name, buyer_email)
       values ($1, $1, 'online', 'Marieke', 'Jan', 'jan@example.com') returning id`,
      [amount],
    );
    const active = await db.query<{ code: string; status: string; valid_until: string }>(
      `select code, status, valid_until::text from activate_gift_voucher($1, 'pi_123')`,
      [rows[0].id],
    );
    return { id: rows[0].id, ...active.rows[0] };
  }

  async function redeem(code: string, amount: number) {
    return db
      .query<{ balance_cents: number }>(`select balance_cents from redeem_gift_voucher($1, $2, null)`, [code, amount])
      .then((r) => ({ ok: true as const, balance: r.rows[0].balance_cents }))
      .catch((e: { code?: string }) => ({ ok: false as const, code: e.code }));
  }

  it('gives a pending voucher no code until it is paid for', async () => {
    const { rows } = await db.query<{ code: string | null; status: string }>(
      `insert into gift_vouchers (amount_cents, balance_cents, source) values (5000, 5000, 'online') returning code, status`,
    );
    expect(rows[0]).toEqual({ code: null, status: 'pending' });
  });

  it('activates once, with a well-formed code valid for a year', async () => {
    const v = await paidOnline();
    expect(v.status).toBe('active');
    expect(v.code).toMatch(/^\d{5}$/);
    expect(Number(v.code)).toBeGreaterThanOrEqual(10000);

    const days = await db.query<{ n: number }>(`select ($1::date - gift_voucher_today())::int as n`, [v.valid_until]);
    expect(days.rows[0].n).toBeGreaterThanOrEqual(365);

    // The webhook and the thank-you page both activate; the second call must
    // hand back the same code, not mint a new one.
    const again = await db.query<{ code: string }>(`select code from activate_gift_voucher($1, 'pi_123')`, [v.id]);
    expect(again.rows[0].code).toBe(v.code);
  });

  it('spends a voucher over several visits and refuses to overspend', async () => {
    const v = await paidOnline(5000);
    await asStaff(async () => {
      expect(await redeem(v.code, 3000)).toEqual({ ok: true, balance: 2000 });
      // Typed sloppily at the bar, still the same voucher.
      expect(await redeem(v.code.toLowerCase().replace(/-/g, ''), 1500)).toEqual({ ok: true, balance: 500 });
      expect(await redeem(v.code, 600)).toEqual({ ok: false, code: 'TN014' });
      expect(await redeem(v.code, 0)).toEqual({ ok: false, code: 'TN013' });
    }, VOUCHERS);

    const ledger = await db.query<{ n: number; total: number }>(
      `select count(*)::int as n, sum(amount_cents)::int as total from gift_voucher_redemptions where voucher_id = $1`,
      [v.id],
    );
    expect(ledger.rows[0]).toEqual({ n: 2, total: 4500 });
  });

  it('refuses unknown, unpaid, cancelled and expired vouchers', async () => {
    const v = await paidOnline();
    await asStaff(async () => {
      expect(await redeem('22222', 100)).toEqual({ ok: false, code: 'TN010' });

      await db.query(`select void_gift_voucher($1, 'refunded')`, [v.id]);
      expect(await redeem(v.code, 100)).toEqual({ ok: false, code: 'TN011' });
    }, VOUCHERS);

    const old = await paidOnline();
    await db.query(`update gift_vouchers set valid_until = gift_voucher_today() - 1 where id = $1`, [old.id]);
    await asStaff(async () => {
      expect(await redeem(old.code, 100)).toEqual({ ok: false, code: 'TN012' });
    }, VOUCHERS);
  });

  it('is staff with the vouchers permission only', async () => {
    const v = await paidOnline();
    expect(await redeem(v.code, 100)).toEqual({ ok: false, code: '42501' });
    await asStaff(async () => {
      expect(await redeem(v.code, 100)).toEqual({ ok: false, code: '42501' });
    }, ['bookings']);
  });

  it('issues a bar voucher straight to active, attributed to whoever sold it', async () => {
    await asStaff(async () => {
      const { rows } = await db.query<{ status: string; source: string; code: string; issued_by: string | null; balance_cents: number }>(
        `select status, source, code, issued_by, balance_cents from issue_gift_voucher(7500, 'Kat', 'Fred', '')`,
      );
      expect(rows[0].status).toBe('active');
      expect(rows[0].source).toBe('bar');
      expect(rows[0].balance_cents).toBe(7500);
      expect(rows[0].issued_by).not.toBeNull();
      expect(rows[0].code).toMatch(/^\d{5}$/);
    }, VOUCHERS);
  });

  it('refuses a balance above the value or below zero', async () => {
    await expect(
      db.exec(`insert into gift_vouchers (amount_cents, balance_cents, source) values (5000, 6000, 'bar')`),
    ).rejects.toThrow();
    await expect(
      db.exec(`insert into gift_vouchers (amount_cents, balance_cents, source) values (5000, -1, 'bar')`),
    ).rejects.toThrow();
  });

  it('takes vouchers up to 3000 euros and no more (0054)', async () => {
    await db.exec(`insert into gift_vouchers (amount_cents, balance_cents, source) values (300000, 300000, 'online')`);
    await expect(
      db.exec(`insert into gift_vouchers (amount_cents, balance_cents, source) values (300100, 300100, 'online')`),
    ).rejects.toThrow();
  });

  it('accepts the vouchers permission on a staff member', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into auth.users (id) values (gen_random_uuid()) returning id`);
    await db.query(`insert into staff (user_id, email, permissions) values ($1, 'till@staff.ta-nnin.be', $2)`, [
      rows[0].id,
      ['vouchers'],
    ]);
  });
});
