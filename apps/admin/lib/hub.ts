/**
 * Which hub this tab came in through, so Back and the home logo return to it.
 *
 * The hub writes this on arrival (see `AuthGate`) and everything else reads it.
 * `sessionStorage`, so it dies with the tab; reading it throws in private mode,
 * hence the try/catch, and falling back to `/` is the right way to fail.
 */
export const HUB_KEY = 'tannin-admin-hub';

export function readHub(): string {
  try {
    return sessionStorage.getItem(HUB_KEY) ?? '/';
  } catch {
    return '/';
  }
}
