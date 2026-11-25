'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import { isStaff } from '@tannin/supabase';
import { getDb } from '@/lib/supabase';
import { displayIdentity, resolveIdentity } from '@/lib/identity';
import { HUB_KEY, readHub } from '@/lib/hub';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BookingNotifier } from '@/components/BookingNotifier';
import { PendingBadge } from '@/components/PendingBadge';
import { NewEventsBadge } from '@/components/NewEventsBadge';

type Permission = 'sold_out' | 'menu' | 'drinks' | 'bookings' | 'tables' | 'people' | 'marketing' | 'vouchers';

type State =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'not-staff'; email: string }
  | { status: 'ready'; email: string; permissions: Permission[] };

/**
 * The hub tiles, and what each needs to be worth showing.
 *
 * A tile somebody cannot use is not a neutral thing to leave in place: they
 * tap it mid-service, get a screen that refuses them, and learn to distrust
 * the whole app. `sold_out` earns the lists because marking something gone
 * is done from them.
 */
const TABS: { href: string; label: string; needs: Permission[] }[] = [
  // Reservation tiles first. Ta-nnin books through Zenchef, so they are hidden
  // (see RESERVATION_TABS). Tonight's service is the list and
  // the floor map on one screen, switched by the List/Map toggle in its header,
  // so it is one tile, not three.
  { href: '/bookings', label: 'Today', needs: ['bookings', 'tables'] },
  { href: '/reservations', label: 'Reservations', needs: ['bookings'] },
  { href: '/tables', label: 'Tables', needs: ['tables'] },
  // Then the content tiles, in the order they read on Ta-nnin's own hub:
  // Wine, Bar, Food, Events, Closures, People.
  { href: '/wine', label: 'Wine', needs: ['drinks', 'sold_out'] },
  { href: '/bar', label: 'Bar', needs: ['drinks', 'sold_out'] },
  { href: '/menu', label: 'Food', needs: ['menu', 'sold_out'] },
  { href: '/order', label: 'Order', needs: ['menu', 'drinks'] },
  { href: '/print', label: 'Print', needs: ['menu', 'drinks'] },
  { href: '/vouchers', label: 'Vouchers', needs: ['vouchers'] },
  { href: '/events', label: 'Events', needs: ['marketing'] },
  { href: '/social', label: 'Social', needs: ['marketing'] },
  // The website's own texts and the pages staff add (from the 58diamonds admin).
  { href: '/texts', label: 'Texts', needs: ['marketing'] },
  { href: '/pages', label: 'Pages', needs: ['marketing'] },
  { href: '/closures', label: 'Closures', needs: ['tables'] },
  { href: '/staff', label: 'People', needs: ['people'] },
];

/**
 * The tiles that belong to the in-house reservation system.
 *
 * Ta-nnin books through Zenchef, so the hub does not show these. Closures stays on both: it is how the bar marks a day it is
 * exceptionally shut, which the public site reads.
 */
const RESERVATION_TABS = ['/bookings', '/reservations', '/tables'];

/**
 * Sign-in by username and password: `tawat`, not an email address. Four people
 * work here and none of them should have to remember which address they were
 * signed up with. `lib/identity` turns what they type into the address
 * Supabase is keyed by.
 *
 * An email still works if one is typed, which is how an owner keeps a real
 * inbox as the way back in - see the note there.
 *
 * This component decides what to *render*; it is not what enforces anything.
 * Row-level security rejects writes from anyone without a `staff` row even if
 * they bypass this entirely.
 *
 * Two shapes, chosen by `variant`:
 *  - `hub` (the page at `/`): the logo, sign-out, and nothing else but a grid
 *    of the tiles this person can use. No content competes with "where do I
 *    go" on the one screen whose whole job is answering that.
 *  - `tab` (every other page, the default): the same logo, plus a single
 *    Back button and the page's own content. The other five tiles are gone -
 *    a tab you cannot see cannot be tapped by accident mid-service, and Back
 *    always means the same thing: the hub.
 */
export function AuthGate({
  children,
  variant = 'tab',
}: {
  children?: React.ReactNode;
  variant?: 'hub' | 'tab';
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [who, setWho] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Where Back and the home logo point - see the effect that records it below.
  const [home, setHome] = useState('/');

  async function resolve(session: Session | null) {
    if (!session?.user) return setState({ status: 'signed-out' });
    const addr = session.user.email ?? '';

    if (!(await isStaff(getDb()))) return setState({ status: 'not-staff', email: addr });

    /*
     * Read to decide which tabs to draw, and for nothing else. Every screen
     * behind them is guarded by row-level security whatever this returns -
     * hiding a tab is a courtesy, not a lock.
     */
    const { data } = await getDb()
      .from('staff')
      .select('permissions')
      .eq('user_id', session.user.id)
      .maybeSingle();

    setState({
      status: 'ready',
      email: addr,
      permissions: ((data?.permissions ?? []) as Permission[]),
    });
  }

  /**
   * Signing out sends you to the front, not to wherever you happened to be.
   *
   * Otherwise the next person lands on the sign-in form with, say, /staff still
   * in the address bar, and is dropped straight onto the People page the moment
   * they sign in - which is both a strange welcome and, for someone without the
   * permission, an immediate refusal.
   */
  async function signOut() {
    try {
      sessionStorage.removeItem(HUB_KEY);
    } catch {
      /* private mode - nothing to clear */
    }
    await getDb().auth.signOut();
    window.location.href = '/';
  }

  // Always the latest closure, so the idle timer below can call it without
  // re-subscribing its listeners every render.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    getDb().auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = getDb().auth.onAuthStateChange((_e, session) => resolve(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * Remember which hub sent you here, so Back and the home logo return to it.
   *
   * The hub records itself and every other page reads it. Session-scoped, so
   * it clears itself when the tab closes.
   */
  useEffect(() => {
    try {
      if (variant === 'hub') {
        const h = '/';
        sessionStorage.setItem(HUB_KEY, h);
        setHome(h);
      } else {
        setHome(readHub());
      }
    } catch {
      /* private mode: fall back to the real hub */
    }
  }, [variant]);

  /**
   * Signed out after half an hour of nobody touching the screen.
   *
   * This runs behind the bar, on a shared phone or tablet - someone forgetting
   * to sign out at the end of a shift leaves the next person's session open
   * to whoever picks it up next. `pointerdown`/`keydown` cover touch, mouse
   * and keyboard; `passive: true` means listening for them costs nothing on
   * every scroll and tap.
   */
  useEffect(() => {
    if (state.status !== 'ready') return;
    const IDLE_MS = 30 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => signOutRef.current(), IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [state.status]);

  /**
   * Password sign-in, for the phone behind the bar.
   *
   * The password lives in Supabase Auth and nowhere else - not in this repo,
   * not in an env var, not in a config file. Supabase hashes it and this
   * component never sees anything but what the person at the keyboard typed.
   * Changing it is a job for the Supabase dashboard, not a deploy.
   */
  async function signIn(e: React.SyntheticEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const id = resolveIdentity(who);
    if (!id.ok) return setError(id.reason);

    setBusy(true);
    const { error: err } = await getDb().auth.signInWithPassword({
      email: id.address,
      password,
    });
    setBusy(false);
    // Deliberately vague: a distinct "no such account" message tells anyone
    // guessing which usernames are real.
    if (err) setError('That username and PIN did not match.');
    setPassword('');
  }

  if (state.status === 'loading') {
    return <p className="p-8 text-sm text-[var(--text-muted)]">One moment…</p>;
  }

  if (state.status === 'signed-out') {
    return (
      <main className="terminal flex min-h-svh flex-col justify-center px-5 py-10">
        <div className="mx-auto w-full max-w-sm">
          <p className="terminal-prompt">Ta-nnin // staff terminal</p>
          <h1 className="terminal-cursor mt-1 text-2xl font-semibold tracking-[0.08em]">ACCESS</h1>

          <form
            onSubmit={signIn}
            onKeyDown={(e) => {
              // A keyboard user types the PIN and presses Enter - submit without
              // reaching for the on-screen Sign in button, wherever focus sits
              // (the keypad buttons included).
              if (e.key === 'Enter') {
                e.preventDefault();
                signIn(e);
              }
            }}
            className="mt-8"
          >
            <label htmlFor="who" className="terminal-prompt block">
              Username
            </label>
            <input
              id="who"
              // Not type="email": that would make a phone reject a bare
              // username before it ever reached us.
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className="terminal-field mt-2"
              placeholder="User Name"
            />

            <label htmlFor="password" className="terminal-prompt mt-7 block text-center">
              PIN
            </label>
            {/*
             * A real input, not a decoration - a keyboard or a password
             * manager can still fill it. The keypad below writes into
             * the same value, for the thumb that would rather tap than
             * type. Digits only, in both directions: a keypad cannot
             * produce a letter, and typed input is filtered the same
             * way so the two paths can never disagree.
             */}
            <input
              id="password"
              type="password"
              required
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
              className="terminal-pin mt-2"
              placeholder="•••••"
            />

            <div className="keypad mt-5" role="group" aria-label="PIN keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => setPassword((p) => p + digit)}
                  className="keypad-btn"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPassword('')}
                className="keypad-btn keypad-btn-quiet"
              >
                Clear
              </button>
              <button type="button" onClick={() => setPassword((p) => p + '0')} className="keypad-btn">
                0
              </button>
              <button
                type="button"
                onClick={() => setPassword((p) => p.slice(0, -1))}
                aria-label="Backspace"
                className="keypad-btn keypad-btn-quiet"
              >
                ⌫
              </button>
            </div>

            <button type="submit" disabled={busy} className="terminal-submit mt-6 w-full">
              {busy ? 'Connecting…' : 'Sign in'}
            </button>

            {error && <p className="mt-3 text-sm text-[var(--term-danger)]">! {error}</p>}
          </form>
        </div>
      </main>
    );
  }

  if (state.status === 'not-staff') {
    return (
      <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-5">
        <h1 className="text-lg font-semibold">No access</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          You are signed in as {displayIdentity(state.email)}, but that is not on the staff list. Someone
          with access has to add you.
        </p>
        <button onClick={signOut} className="btn btn-quiet mt-6">
          Sign out
        </button>
      </main>
    );
  }

  const tabs = TABS.filter(
    (tab) =>
      !RESERVATION_TABS.includes(tab.href) &&
      tab.needs.some((p) => state.permissions.includes(p)),
  );

  return (
    <>
      {/* Wherever staff are standing, not just the hub - the same `tables`
          permission the floor plan and Closures already gate on. */}
      {state.permissions.includes('tables') && <BookingNotifier />}
      <header className="border-b border-[var(--surface-edge)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          {/* The logo is the home button on every page, hub included. */}
          <Link href={home} className="text-[0.9rem] font-semibold tracking-[0.02em]">
            Ta-nnin
          </Link>
          <div className="flex items-center gap-2">
            {/* A request that came in while nobody was watching, made obvious on
                every screen - the same `bookings` permission the Tonight tile needs. */}
            {state.permissions.includes('bookings') && <PendingBadge />}
            <span className="truncate text-[0.75rem] text-[var(--text-muted)]">
              {displayIdentity(state.email)}
            </span>
            <ThemeToggle />
            <button onClick={signOut} className="btn btn-quiet min-h-11 px-4">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {variant === 'hub' ? (
        <main className="mx-auto max-w-md px-4 py-8">
          {tabs.length > 0 ? (
            /*
             * Big tiles, not a row of small caps. This is used one-handed, on
             * a phone, by somebody holding something else - min-h-28 with
             * min-h-11 (~44px) worth of tap target is the smallest a thumb
             * reliably finds, and two columns keep every tile reachable
             * without scrolling on a phone screen.
             */
            <nav className="grid grid-cols-2 gap-3">
              {tabs.map((tab) => (
                <a
                  key={tab.href}
                  href={tab.href}
                  className="card relative flex min-h-28 flex-col items-center justify-center gap-1 px-4 py-6 text-center text-[0.85rem] font-medium uppercase tracking-[0.1em]"
                >
                  {tab.label}
                  {tab.href === '/bookings' && <NewEventsBadge scope="today" />}
                  {tab.href === '/reservations' && <NewEventsBadge scope="reservations" />}
                </a>
              ))}
            </nav>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Nothing here yet - someone with People access has to give you a permission first.
            </p>
          )}
        </main>
      ) : (
        <>
          <div className="px-3 pt-3">
            <Link href={home} className="btn btn-quiet min-h-11 inline-flex items-center px-4">
              ← Back
            </Link>
          </div>
          {children}
        </>
      )}
    </>
  );
}
