/**
 * Where this deployment actually lives.
 *
 * Not a constant, because right now it is three different answers: a Vercel URL
 * for the demo Tawat is looking at, a per-branch URL on previews, and localhost
 * when somebody runs it. It used to fall back to `ta-nnin.be` regardless, which
 * was wrong in a way that only showed up after a booking - the cancel link in
 * the guest's email pointed at a domain the site is not on yet, so the one
 * thing in the email a guest can click went nowhere.
 *
 * Vercel sets the deployment variables itself and exposes the `NEXT_PUBLIC_`
 * copies to the browser bundle, so nothing needs configuring for the demo. When
 * `ta-nnin.be` is attached to the project as its production domain,
 * `VERCEL_PROJECT_PRODUCTION_URL` becomes that domain on its own and the site
 * goes live with no code change and no variable to remember - attach, redeploy.
 */

/** The domain the site is going to. Compared against, never assumed. */
const PRODUCTION_URL = 'https://ta-nnin.be';

function resolveSiteUrl(): string {
  // An explicit setting always wins - it is the escape hatch for anything the
  // guesses below get wrong.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit;

  /*
   * On a preview, the project's production URL is the wrong answer: a preview
   * should link to itself, or a tester clicking Cancel in their email cancels
   * against whatever is live. `VERCEL_URL` is this deployment specifically.
   */
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const host =
    env === 'production'
      ? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim()
      : process.env.NEXT_PUBLIC_VERCEL_URL?.trim();

  if (host) return `https://${host}`;

  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl().replace(/\/$/, '');

/**
 * Whether this is the real site or a copy of it.
 *
 * Everything that is not `ta-nnin.be` - the demo, previews, localhost - is a
 * copy, and a copy must not be indexed. A demo turning up in a search for the
 * bar would be a half-finished version of the place competing with the real
 * one, and Google treating two identical sites as rivals rather than as one.
 */
export const IS_LIVE_SITE = SITE_URL === PRODUCTION_URL;
