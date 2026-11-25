import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware replacements for `next/link` and friends. Use these everywhere
 * instead of `next/link`, otherwise a link from a Dutch page lands the reader
 * back in English.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
