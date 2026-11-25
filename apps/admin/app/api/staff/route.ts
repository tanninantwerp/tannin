import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { passwordError, resolveIdentity } from '@/lib/identity';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } from '@/lib/supabase-keys';

/**
 * Staff management.
 *
 * Creating a login requires Supabase's admin API, which needs the service-role
 * key - and that key bypasses row-level security entirely, so it can never go
 * near the browser. Hence a server route: the key stays in the server
 * environment and the client only ever sees the result.
 *
 * Every request is checked twice:
 *   1. the caller's own token must belong to somebody holding 'people'
 *   2. the mutation itself still runs against the database, whose policies and
 *      triggers refuse to leave the room with nobody who can manage people
 *
 * The second check is what actually protects things. The first just means we
 * fail early with a sensible message.
 */

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = SUPABASE_ANON_KEY;
const SERVICE = SUPABASE_SERVICE_KEY;

/**
 * The permissions somebody can hold. Same six as 0012's check constraint -
 * anything outside this list is refused by the database too, so a typo here
 * fails loudly rather than granting a power no screen can take back.
 */
const PERMISSIONS = ['sold_out', 'menu', 'drinks', 'bookings', 'tables', 'people', 'marketing', 'vouchers'] as const;
type Permission = (typeof PERMISSIONS)[number];

/** Drops anything unrecognised rather than rejecting the whole request. */
function cleanPermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  return PERMISSIONS.filter((p) => input.includes(p));
}

function admin() {
  return createClient(URL_, SERVICE, { auth: { persistSession: false } });
}

/**
 * Resolves the caller from their bearer token, and whether they manage people.
 *
 * `why` matters as much as `ok`. An expired token and a real refusal are
 * completely different problems - one is "sign in again", the other is "ask an
 * owner" - and reporting both as "you cannot manage people" sent somebody
 * hunting through permissions for an hour when their session had simply run
 * out. Access tokens last an hour; a tab left open across a shift will hit this
 * every time.
 */
type Caller =
  | { ok: true; userId: string }
  | { ok: false; why: 'no-session' | 'not-permitted'; userId?: string };

async function callerManagesPeople(req: Request): Promise<Caller> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, why: 'no-session' };

  // Anon client carrying the caller's token, so RLS sees them as themselves.
  const asCaller = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: auth } = await asCaller.auth.getUser();
  // Rejected token: expired, or from a project this deployment does not point at.
  if (!auth.user) return { ok: false, why: 'no-session' };

  const { data, error } = await asCaller
    .from('staff')
    .select('permissions')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const held = (data?.permissions ?? []) as string[];
  if (error || !held.includes('people')) {
    return { ok: false, why: 'not-permitted', userId: auth.user.id };
  }
  return { ok: true, userId: auth.user.id };
}

/** 401 says "sign in again"; 403 says "ask somebody who can". */
function refuse(caller: Caller & { ok: false }) {
  return caller.why === 'no-session'
    ? NextResponse.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
    : NextResponse.json({ error: 'You cannot manage people.' }, { status: 403 });
}

function guard(missing: boolean) {
  if (missing) {
    return NextResponse.json(
      { error: 'The server is missing SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 },
    );
  }
  return null;
}

export async function GET(req: Request) {
  const bad = guard(!SERVICE);
  if (bad) return bad;

  const caller = await callerManagesPeople(req);
  if (!caller.ok) return refuse(caller);

  const { data, error } = await admin()
    .from('staff')
    .select('user_id, email, full_name, permissions, active, created_at')
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ staff: data ?? [] });
}

export async function POST(req: Request) {
  const bad = guard(!SERVICE);
  if (bad) return bad;

  const caller = await callerManagesPeople(req);
  if (!caller.ok) return refuse(caller);

  const body = (await req.json().catch(() => null)) as {
    username?: string;
    password?: string;
    fullName?: string;
    permissions?: unknown;
  } | null;

  const password = body?.password ?? '';
  const permissions = cleanPermissions(body?.permissions);

  /*
   * Resolved here and not trusted from the form: the browser is not the only
   * thing that can post to this route, and a username that skipped the rules
   * would become a login nobody can type the same way twice.
   */
  const id = resolveIdentity(body?.username ?? '');
  if (!id.ok) return NextResponse.json({ error: id.reason }, { status: 400 });
  const email = id.address;

  const pwError = passwordError(password);
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  const sb = admin();

  const { data: created, error: createError } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // an owner vouched for them; no need for a round trip
    user_metadata: body?.fullName ? { full_name: body.fullName } : undefined,
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'Could not create that login.' }, { status: 400 });
  }

  const { error: staffError } = await sb.from('staff').insert({
    user_id: created.user.id,
    email,
    full_name: body?.fullName ?? null,
    permissions,
  });

  if (staffError) {
    // Leave no orphan login behind if the staff row fails.
    await sb.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: staffError.message }, { status: 400 });
  }

  return NextResponse.json({ userId: created.user.id, username: body?.username?.trim().toLowerCase(), permissions });
}

export async function PATCH(req: Request) {
  const bad = guard(!SERVICE);
  if (bad) return bad;

  const caller = await callerManagesPeople(req);
  if (!caller.ok) return refuse(caller);

  const body = (await req.json().catch(() => null)) as {
    userId?: string;
    permissions?: unknown;
    active?: unknown;
  } | null;
  if (!body?.userId) return NextResponse.json({ error: 'Which user?' }, { status: 400 });

  // Either field on its own, so the on/off switch does not have to resend a
  // permission list it never showed the person operating it.
  const patch: { permissions?: string[]; active?: boolean } = {};
  if (Array.isArray(body.permissions)) patch.permissions = cleanPermissions(body.permissions);
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  // 0012's trigger is what really enforces this: it refuses to remove the last
  // person who can manage people, however the request got here.
  const { error } = await admin().from('staff').update(patch).eq('user_id', body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/**
 * Set somebody's password.
 *
 * This is what a username costs. With no inbox there is no "forgot my
 * password" mail, so somebody forgetting theirs has to be fixed by a person -
 * and without this route that person has to be whoever holds the Supabase
 * dashboard, at whatever hour the bar discovers it.
 *
 * Owners only, and only for people on the staff list. That second check is not
 * decoration: the service-role key can rewrite the password of *any* account
 * in the project, so without it a bug in the caller check would be a way to
 * take over an unrelated login. The staff table is the fence.
 */
export async function PUT(req: Request) {
  const bad = guard(!SERVICE);
  if (bad) return bad;

  const caller = await callerManagesPeople(req);
  if (!caller.ok) return refuse(caller);

  const body = (await req.json().catch(() => null)) as {
    userId?: string;
    password?: string;
  } | null;

  const password = body?.password ?? '';
  if (!body?.userId) return NextResponse.json({ error: 'Which user?' }, { status: 400 });
  const pwError = passwordError(password);
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  const sb = admin();

  const { data: staffRow } = await sb
    .from('staff')
    .select('user_id, email')
    .eq('user_id', body.userId)
    .maybeSingle();

  if (!staffRow) {
    return NextResponse.json({ error: 'That person is not on the staff list.' }, { status: 404 });
  }

  const { error } = await sb.auth.admin.updateUserById(body.userId, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const bad = guard(!SERVICE);
  if (bad) return bad;

  const caller = await callerManagesPeople(req);
  if (!caller.ok) return refuse(caller);

  const userId = new URL(req.url).searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'Which user?' }, { status: 400 });
  if (userId === caller.userId) {
    return NextResponse.json({ error: 'You cannot remove yourself.' }, { status: 400 });
  }

  const sb = admin();

  // Staff row first: its trigger refuses if this is the last owner, and we do
  // not want the login gone in that case.
  const { error: staffError } = await sb.from('staff').delete().eq('user_id', userId);
  if (staffError) return NextResponse.json({ error: staffError.message }, { status: 400 });

  const { error: authError } = await sb.auth.admin.deleteUser(userId);
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
