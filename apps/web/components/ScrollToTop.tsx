'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';

/**
 * Scroll to top whenever the route changes. On iOS especially, navigating back
 * (or forward) preserves scroll position, which feels broken - every new page
 * should start at the top.
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
