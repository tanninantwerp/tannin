import { Hero, type NeonTone } from '@/components/Hero';
import { Wine } from '@/components/Wine';
import { Accolades } from '@/components/Accolades';
import { FromTheStreet } from '@/components/FromTheStreet';
import { SiteFooter } from '@/components/SiteFooter';
import { fetchPublishedSocialPosts, fetchCurrentStory, fetchWines } from '@tannin/supabase';
import { getServerDb } from '@/lib/supabase-server';

/**
 * The home page itself, minus the routing around it.
 *
 * It lives here rather than in `page.tsx` because there are now three routes
 * showing it - `/` and the two colourways at `/home2` and `/home3` - and a
 * colourway is only worth looking at if it is the real page underneath. Copied
 * into three files it would stop being that the first time the home page moved
 * and somebody updated one of them.
 *
 * So the only thing a route may vary is `neon`. Everything else - the sections,
 * their order, the live data behind them - is this file, once.
 */
export async function HomeContent({ neon = 'yellow' }: { neon?: NeonTone } = {}) {
  const [posts, story, wines] = await Promise.all([
    fetchPublishedSocialPosts(getServerDb()).catch(() => []),
    fetchCurrentStory(getServerDb()).catch(() => null),
    // The same query /wine counts, so the two pages cannot disagree about how
    // many bottles are in the cellar. Null on failure, which makes Wine fall
    // back to the static list rather than print a zero.
    fetchWines(getServerDb()).catch(() => null),
  ]);

  return (
    <>
      <Hero neon={neon} />
      <Wine {...(wines ? { cellarCount: wines.length } : {})} />
      {/* Directly after the wine pitch: a claim, then the evidence for it. */}
      <FromTheStreet posts={posts} story={story} />
      <Accolades />
      <SiteFooter />
    </>
  );
}
