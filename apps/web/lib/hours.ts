import { unstable_cache } from 'next/cache';
import { SERVICE_WINDOWS, toISODate } from '@tannin/core';
import type { ServiceWindow } from '@tannin/core';
import { fetchHoursExceptions, fetchServiceWindows } from '@tannin/supabase';
import type { HoursException } from '@tannin/supabase';
import { serverDb } from '@/lib/server-db';

/**
 * The live opening hours for server rendering - the hours block on the site and
 * the search-result schema.
 *
 * Cached with a ten-minute revalidate rather than read on every render: these
 * pages are otherwise statically generated, and an uncached database read in
 * the layout would drop the whole site to dynamic rendering. This keeps them
 * static-with-ISR, so a change staff make in the admin shows up within minutes
 * without a deploy, and the picker (which reads the hours live) is never more
 * than that ahead of what the page advertises.
 *
 * Falls back to the built-in week if the read fails, so the site never renders
 * without hours.
 */
const cached = unstable_cache(
  async (): Promise<ServiceWindow[] | null> => {
    try {
      return await fetchServiceWindows(serverDb());
    } catch {
      return null;
    }
  },
  ['service-windows'],
  { revalidate: 600 },
);

export async function openingHours(): Promise<readonly ServiceWindow[]> {
  return (await cached()) ?? SERVICE_WINDOWS;
}

/**
 * The one-off exceptions to those hours - closed days and special nights - from
 * today on, for the hours block on the site. Same ten-minute revalidate, keyed
 * by the day so a passed exception drops off without a deploy. Empty on failure,
 * so the hours block simply shows the regular week.
 */
const cachedExceptions = unstable_cache(
  async (from: string): Promise<HoursException[]> => {
    try {
      return await fetchHoursExceptions(serverDb(), from);
    } catch {
      return [];
    }
  },
  ['hours-exceptions'],
  { revalidate: 600 },
);

export async function upcomingHoursExceptions(): Promise<HoursException[]> {
  return cachedExceptions(toISODate(new Date()));
}
