'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { GIFT_LINK } from './nav-links';

/**
 * The Gift vouchers tab, in both headers, just before Reserve.
 *
 * Filled rather than framed like the other links, so it gets the frame's job
 * done with `aria-current` alone: the fill already sets it apart, and a second
 * box round a solid button would read as a mistake. The caller passes the
 * styling, as with `BookCta`, so each header can size it to match its Reserve.
 */
export function GiftCta({ className }: { className: string }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { href, key } = GIFT_LINK;
  const current = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} aria-current={current ? 'page' : undefined} className={className}>
      {t(`nav.${key}`)}
    </Link>
  );
}
