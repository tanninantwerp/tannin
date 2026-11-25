'use client';

import { Link } from '@/i18n/navigation';
import type { StaticRoute } from '@/i18n/routing';
import { type BookTarget } from './nav-links';

/**
 * The Reserve button, in both headers.
 *
 * It renders as an ordinary in-site link when it points at our own booking flow,
 * and as an external link that opens a new tab when it points at the provider
 * the venue actually uses. The caller passes the label and the styling, so the
 * full-size hero and the compact header can size the same button differently.
 */
export function BookCta({
  target,
  label,
  className,
}: {
  target: BookTarget;
  label: string;
  className: string;
}) {
  const to = target;

  if (to.external) {
    return (
      <a href={to.href} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
      </a>
    );
  }

  return (
    <Link href={to.href as StaticRoute} className={className}>
      {label}
    </Link>
  );
}
