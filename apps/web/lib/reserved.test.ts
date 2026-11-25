import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS } from '@tannin/content';
import { routing } from '../i18n/routing';

describe('addresses a page from the admin may not take', () => {
  it('include the first segment of every page of the site, in every language', () => {
    const segments = Object.values(routing.pathnames)
      .flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)))
      .map((p) => p.split('/')[1])
      .filter((s): s is string => Boolean(s));
    const missing = [...new Set(segments)].filter((s) => !RESERVED_SLUGS.includes(s));
    expect(missing).toEqual([]);
  });
});
