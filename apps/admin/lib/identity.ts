/**
 * Who staff say they are when they sign in.
 *
 * Supabase Auth has no username mode - every account is keyed by something
 * email-shaped, and that is not a setting we can turn off. So staff type a bare
 * username and this builds the address underneath. `tawat` becomes
 * `tawat@staff.ta-nnin.be`, which is a subdomain we own and deliberately never
 * route: no inbox, no MX record, nothing listening. It exists to be a unique
 * key, and nobody ever sees or types it.
 *
 * The consequence to know about: a username has no inbox, so the "forgot my
 * password" mail has nowhere to go. Resetting one is an owner's job in the
 * Supabase dashboard rather than something the person can do themselves. That
 * is the deal we took in exchange for four people not having to remember which
 * email address they signed up with.
 *
 * An address with an `@` is still accepted and passed through untouched. That
 * is the way back in: keep at least one owner on a real inbox, because an
 * account nobody can be mailed about is an account nobody can recover.
 */

/** Never routed. Owned so nobody else can ever receive as one of our staff. */
export const STAFF_DOMAIN = 'staff.ta-nnin.be';

/**
 * Shortest password the admin will accept.
 *
 * Five, at Sacha's instruction, down from ten. Worth being clear-eyed about
 * what that means rather than burying it: this admin is on the open internet
 * and a login on it can change every price on the site, so five characters is
 * a short guess away from a stranger doing that. It is defensible because the
 * people typing it are four staff behind a bar on a phone, and a password
 * nobody can type is a password taped to the till.
 *
 * The two things that would actually carry the weight, if this ever matters
 * more than convenience: Supabase's own rate limiting on failed sign-ins, and
 * turning on leaked-password protection in the Auth settings.
 *
 * One number, used by the form, the API and the tests, so they cannot drift.
 */
export const MIN_PASSWORD = 5;

/*
 * Digits only, PIN-style rather than password-style: the sign-in screen is a
 * keypad now, and a keypad cannot type a letter. Length still carries what
 * little strength this has - see the note above MIN_PASSWORD - so a shorter
 * digit-only PIN is not pretending to be stronger than the password it
 * replaces, just easier to enter one-handed behind a bar.
 *
 * One function, used by the form and the API, so the rule cannot drift.
 */
export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} digits.`;
  if (!/^\d+$/.test(password)) return 'Numbers only, like a PIN.';
  return null;
}

/*
 * Starts with a letter so a username can never be read as a number, and stays
 * lowercase because `Tawat` and `tawat` being two different logins is the kind
 * of thing that is only ever discovered at the door on a Friday.
 */
const USERNAME = /^[a-z][a-z0-9._-]{1,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Identity =
  | { ok: true; address: string; kind: 'username' | 'email' }
  | { ok: false; reason: string };

/**
 * Turn what somebody typed into the address Supabase is keyed by.
 *
 * Case and stray spaces are absorbed here rather than trusted from the form -
 * a phone keyboard capitalises the first letter by default, and that alone
 * would otherwise be a failed sign-in with no visible cause.
 */
export function resolveIdentity(input: string): Identity {
  const value = input.trim().toLowerCase();

  if (!value) return { ok: false, reason: 'Type your username.' };

  if (value.includes('@')) {
    if (!EMAIL.test(value)) return { ok: false, reason: 'That email does not look right.' };
    return { ok: true, address: value, kind: 'email' };
  }

  if (!USERNAME.test(value)) {
    return {
      ok: false,
      reason: 'Usernames are 2–32 characters: a letter first, then letters, numbers, dot, dash or underscore.',
    };
  }

  return { ok: true, address: `${value}@${STAFF_DOMAIN}`, kind: 'username' };
}

/**
 * What to show on screen for a stored address.
 *
 * The synthetic domain is an implementation detail; showing it on the People
 * page would invite somebody to try mailing it.
 */
export function displayIdentity(address: string): string {
  const suffix = `@${STAFF_DOMAIN}`;
  return address.endsWith(suffix) ? address.slice(0, -suffix.length) : address;
}
