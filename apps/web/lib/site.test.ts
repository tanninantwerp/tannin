import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Which URL this deployment thinks it is.
 *
 * Worth testing because getting it wrong is silent. The old fallback said
 * `ta-nnin.be` whatever was actually serving the pages, and nothing complained
 * - the site looked perfect and the cancel link in every booking email pointed
 * at a domain that does not serve it. A wrong answer here is only ever found by
 * somebody clicking.
 *
 * `SITE_URL` is read once at import, which is what makes it cheap everywhere
 * else, so each case has to load the module fresh.
 */

const VARS = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_VERCEL_ENV',
  'NEXT_PUBLIC_VERCEL_URL',
  'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL',
] as const;

async function load(env: Partial<Record<(typeof VARS)[number], string>>) {
  vi.resetModules();
  // Cleared rather than merged: a real deployment sets some of these and not
  // others, and a leftover from the previous case would hide exactly that.
  for (const key of VARS) vi.stubEnv(key, env[key] ?? '');
  return import('./site');
}

afterEach(() => vi.unstubAllEnvs());

describe('SITE_URL', () => {
  it('takes an explicit setting over anything Vercel says', async () => {
    const { SITE_URL } = await load({
      NEXT_PUBLIC_SITE_URL: 'https://staging.example.com',
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'tannin.vercel.app',
    });
    expect(SITE_URL).toBe('https://staging.example.com');
  });

  it('uses the project domain on a production deployment', async () => {
    // The demo Tawat is looking at.
    const { SITE_URL } = await load({
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'tannin.vercel.app',
      NEXT_PUBLIC_VERCEL_URL: 'tannin-abc123.vercel.app',
    });
    expect(SITE_URL).toBe('https://tannin.vercel.app');
  });

  it('uses this deployment on a preview, not the live one', async () => {
    // Otherwise a tester clicking Cancel in a preview's email cancels a real
    // booking on whatever is live.
    const { SITE_URL } = await load({
      NEXT_PUBLIC_VERCEL_ENV: 'preview',
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'tannin.vercel.app',
      NEXT_PUBLIC_VERCEL_URL: 'tannin-abc123.vercel.app',
    });
    expect(SITE_URL).toBe('https://tannin-abc123.vercel.app');
  });

  it('falls back to localhost, never to a domain we are not on', async () => {
    expect((await load({})).SITE_URL).toBe('http://localhost:3000');
  });

  it('drops a trailing slash, so paths do not double up', async () => {
    const { SITE_URL } = await load({ NEXT_PUBLIC_SITE_URL: 'https://ta-nnin.be/' });
    expect(SITE_URL).toBe('https://ta-nnin.be');
  });
});

describe('IS_LIVE_SITE', () => {
  it('is false for the demo, previews and localhost', async () => {
    for (const env of [
      { NEXT_PUBLIC_VERCEL_ENV: 'production', NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'tannin.vercel.app' },
      { NEXT_PUBLIC_VERCEL_ENV: 'preview', NEXT_PUBLIC_VERCEL_URL: 'tannin-abc.vercel.app' },
      {},
    ]) {
      expect((await load(env)).IS_LIVE_SITE).toBe(false);
    }
  });

  it('turns true on its own once the domain is attached', async () => {
    // The whole migration: point ta-nnin.be at the project, redeploy. Vercel
    // fills in the production URL itself, so there is no variable anybody has
    // to remember and no code change.
    const { IS_LIVE_SITE } = await load({
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: 'ta-nnin.be',
    });
    expect(IS_LIVE_SITE).toBe(true);
  });

  it('is not fooled by a lookalike domain', async () => {
    const { IS_LIVE_SITE } = await load({ NEXT_PUBLIC_SITE_URL: 'https://ta-nnin.be.example.com' });
    expect(IS_LIVE_SITE).toBe(false);
  });
});
