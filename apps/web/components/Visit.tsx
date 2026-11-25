import { useLocale, useTranslations } from 'next-intl';
import { LAST_CALL_KITCHEN, SERVICE_WINDOWS, SHOP, VENUE } from '@tannin/core';
import type { ServiceWindow } from '@tannin/core';
import type { HoursException } from '@tannin/supabase';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { LOCALE_TAG } from '@/i18n/tags';

export function Visit({
  windows = SERVICE_WINDOWS,
  exceptions = [],
}: {
  windows?: readonly ServiceWindow[];
  exceptions?: readonly HoursException[];
}) {
  const t = useTranslations('visit');
  const days = useTranslations('weekdays');
  const locale = useLocale();

  const open = new Map(windows.map((w) => [w.weekday, w]));
  // Monday first, the way a Belgian reads a week.
  const week = [1, 2, 3, 4, 5, 6, 0];

  // A short, local date for the exceptions list - "Thu 25 Dec".
  const dateLocale = LOCALE_TAG[locale as Locale];
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(`${iso}T00:00:00`),
    );

  return (
    <section id="visit" className="px-5 py-20 sm:py-28">
      <div className="mx-auto grid max-w-5xl gap-14 md:grid-cols-2">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
            {t('eyebrow')}
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
            {VENUE.street}
          </h2>

          <address className="mt-6 not-italic leading-relaxed text-[var(--text-muted)]">
            {VENUE.street}
            <br />
            {VENUE.postcode} {VENUE.city}
            <br />
            {VENUE.country}
            <br />
            <a href={`tel:${VENUE.phone.replace(/\s/g, '')}`} className="mt-3 inline-block hover:text-[var(--accent)]">
              {VENUE.phone}
            </a>
            <br />
            <a href={`mailto:${VENUE.email}`} className="hover:text-[var(--accent)]">
              {VENUE.email}
            </a>
          </address>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://www.google.com/maps/search/?api=1&query=Ta-nnin+Volkstraat+50+Antwerpen"
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-[var(--color-green-deep)] px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-bone)] transition-opacity hover:opacity-90"
            >
              {t('maps')}
            </a>
            <a
              href={`https://instagram.com/${VENUE.instagram.replace('@', '')}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--surface-edge)] px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] transition-colors hover:border-[var(--accent)]"
            >
              {VENUE.instagram}
            </a>
          </div>

          <p className="mt-8 max-w-prose text-sm leading-relaxed text-[var(--text-muted)]">
            {t('walkIn')}
          </p>

          {/* Same owner, same list - one site covers both addresses. */}
          <aside className="mt-10 border-l-2 border-[var(--accent)] pl-5">
            <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[var(--accent)]">
              {SHOP.tagline}
            </p>
            <h3 className="mt-1 font-[family-name:var(--font-voces)] text-xl">
              <Link href="/cellar" className="hover:text-[var(--accent)]">
                {SHOP.name} →
              </Link>
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              {t('shopBody', { street: SHOP.street })}
            </p>
            <a
              href={`https://instagram.com/${SHOP.instagram.replace('@', '')}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              {SHOP.instagram}
            </a>
          </aside>
        </div>

        <div className="card-stock rounded-sm px-7 py-9">
          <h3 className="menu-heading text-[0.72rem]">{t('hoursHeading')}</h3>
          <dl className="mt-5">
            {week.map((day) => {
              const window = open.get(day);
              return (
                <div
                  key={day}
                  className="flex items-baseline border-b border-[var(--surface-edge)] py-2.5 last:border-0"
                >
                  {/* Dutch does not capitalise weekdays; the catalogue carries that. */}
                  <dt className="text-[0.82rem]">{days(String(day))}</dt>
                  <span className="rule-dotted" aria-hidden="true" />
                  <dd className="text-[0.82rem] tabular-nums text-[var(--text-muted)]">
                    {window ? `${window.opens} – ${window.closes}` : t('closed')}
                  </dd>
                </div>
              );
            })}
          </dl>
          {exceptions.length > 0 && (
            <div className="mt-6 border-t border-[var(--surface-edge)] pt-4">
              <h4 className="menu-heading text-[0.66rem]">{t('exceptionsHeading')}</h4>
              <dl className="mt-3">
                {exceptions.map((ex) => (
                  <div
                    key={ex.date}
                    className="flex items-baseline border-b border-[var(--surface-edge)] py-2 last:border-0"
                  >
                    <dt className="text-[0.82rem]">
                      {fmtDate(ex.date)}
                      {ex.note ? (
                        <span className="text-[var(--text-muted)]"> · {ex.note}</span>
                      ) : null}
                    </dt>
                    <span className="rule-dotted" aria-hidden="true" />
                    <dd className="text-[0.82rem] tabular-nums text-[var(--text-muted)]">
                      {ex.closed ? t('closed') : `${ex.opens} – ${ex.closes}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <p className="mt-5 text-[0.72rem] text-[var(--text-muted)]">
            {t('hoursNote', { time: LAST_CALL_KITCHEN })}
          </p>
        </div>
      </div>
    </section>
  );
}
