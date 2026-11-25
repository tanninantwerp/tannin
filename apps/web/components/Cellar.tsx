import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { SHOP } from '@tannin/core';
import type { Wine } from '@tannin/core';
import type { EventItem } from '@tannin/supabase';
import { Link } from '@/i18n/navigation';
import { EventImage } from './EventImage';
import { NeonCross } from './NeonCross';

/**
 * CE-LLAR, the bottle shop and event space across the road.
 *
 * Same owner and same list as the bar, so it lives on this site rather than its
 * own - but it has its own look on Instagram (a red neon X over the door, red
 * walls) and its own voice (short, casual, signed off "x"), and the page takes
 * both rather than wearing the bar's green.
 *
 * Everything here is either fixed shop facts from `SHOP` or rows the bar
 * already keeps: events tagged as CE-LLAR's, and bottles flagged `inShop`. A
 * section with no rows behind it is left out rather than shown empty.
 */
export function Cellar({
  events = [],
  wines = [],
}: {
  events?: readonly EventItem[];
  wines?: readonly Wine[];
}) {
  const t = useTranslations('cellar');
  const days = useTranslations('weekdays');

  const open = new Map<number, { opens: string; closes: string }>(SHOP.hours.map((h) => [h.weekday, h]));
  // Monday first, the way a Belgian reads a week.
  const week = [1, 2, 3, 4, 5, 6, 0];

  // DD/MM/YYYY, as on the events page.
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  // CE-LLAR's own nights: anything filed as a CE-LLAR event or picked up from
  // its Instagram. What is still to come first; with nothing coming, the last
  // three that happened, so the section shows what the shop does.
  const today = new Date().toISOString().slice(0, 10);
  const own = events.filter((e) => e.kind === 'cellar' || e.sourceAccount === 'cellar');
  const upcoming = own.filter((e) => !e.startsOn || e.startsOn >= today);
  const recent = own
    .filter((e) => e.startsOn && e.startsOn < today)
    .sort((a, b) => (b.startsOn ?? '').localeCompare(a.startsOn ?? ''))
    .slice(0, 3);
  const shown = upcoming.length > 0 ? upcoming : recent;

  const inShop = wines.filter((w) => w.inShop && w.available !== false);

  const instagram = `https://instagram.com/${SHOP.instagram.replace('@', '')}`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${SHOP.street} ${SHOP.postcode} ${SHOP.city}`,
  )}`;

  return (
    <>
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] px-5 py-20 text-[var(--color-paper)] sm:py-28">
        <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-[auto_1fr] md:items-center">
          {/*
            The ceiling's neon cross hangs above the logo; on desktop the text
            sits centred against the two together.
          */}
          <h1 className="flex w-full max-w-[20rem] flex-col items-center gap-8 sm:max-w-[24rem] md:w-[24rem] lg:w-[28rem] lg:max-w-[28rem]">
            <NeonCross className="h-auto w-[58%]" />
            <Image
              src="/brand/cellar-logo.png"
              alt={SHOP.name}
              width={1606}
              height={252}
              priority
              className="h-auto w-full"
            />
          </h1>
          <div className="max-w-md">
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--color-cellar-glow)]">
              {SHOP.tagline}
            </p>
            <p className="mt-3 text-lg leading-relaxed text-[var(--color-paper)]/85">{t('intro')}</p>
            <p className="mt-6 text-[0.68rem] uppercase tracking-[0.3em] text-[var(--color-paper)]/60">
              {SHOP.street} · {SHOP.city}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={maps}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-[var(--color-cellar)] px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-bone)] transition-opacity hover:opacity-90"
              >
                {t('maps')}
              </a>
              <a
                href={instagram}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--color-paper)]/30 px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] transition-colors hover:border-[var(--color-cellar-glow)]"
              >
                {SHOP.instagram}
              </a>
              {/* Vouchers are good at the shop too, so the shop sells them. */}
              <Link
                href="/gift"
                className="rounded-full bg-[var(--color-neon-yellow)] px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink)] transition-opacity hover:opacity-90"
              >
                {t('gift')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:py-24">
        <div className="mx-auto grid max-w-5xl gap-14 md:grid-cols-2">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
              {t('shopEyebrow')}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
              {t('shopHeading')}
            </h2>
            <p className="mt-5 max-w-prose leading-relaxed text-[var(--text-muted)]">{t('shopBody')}</p>
            <p className="mt-4 max-w-prose leading-relaxed text-[var(--text-muted)]">{t('terrace')}</p>
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
                    <dt className="text-[0.82rem]">{days(String(day))}</dt>
                    <span className="rule-dotted" aria-hidden="true" />
                    <dd className="text-[0.82rem] tabular-nums text-[var(--text-muted)]">
                      {window ? `${window.opens} – ${window.closes}` : t('closed')}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-5 text-[0.72rem] text-[var(--text-muted)]">{t('hoursNote')}</p>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--surface-edge)] bg-[var(--surface-raised)] px-5 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
            {t('hostEyebrow')}
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
            {t('hostHeading')}
          </h2>
          <p className="mt-4 max-w-prose text-[var(--text-muted)]">
            {t('hostBody', { guests: SHOP.maxGuests })}
          </p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(['tastings', 'birthdays', 'company', 'yours'] as const).map((k) => (
              <li key={k} className="border-l-2 border-[var(--cellar-ink)] pl-5">
                <h3 className="font-[family-name:var(--font-voces)] text-xl">{t(`host.${k}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{t(`host.${k}.body`)}</p>
              </li>
            ))}
          </ul>
          <a
            href={`mailto:${SHOP.eventsEmail}?subject=${encodeURIComponent(t('hostSubject'))}`}
            className="mt-10 inline-block rounded-full bg-[var(--color-cellar)] px-6 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-bone)] transition-opacity hover:opacity-90"
          >
            {t('hostCta')}
          </a>
          <p className="mt-3 text-[0.8rem] text-[var(--text-muted)]">
            {t('hostOr', { email: SHOP.eventsEmail, handle: SHOP.instagram })}
          </p>
        </div>
      </section>

      {shown.length > 0 && (
        <section className="px-5 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
              {t('eventsEyebrow')}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
              {upcoming.length > 0 ? t('eventsHeading') : t('eventsHeadingPast')}
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((ev) => (
                <article
                  key={ev.id}
                  className="overflow-hidden rounded-sm border border-[var(--surface-edge)] bg-[var(--color-bone)]"
                >
                  {ev.imageUrl && <EventImage imageUrl={ev.imageUrl} sourceUrl={ev.sourceUrl} />}
                  <div className="p-5">
                    {ev.startsOn && (
                      <p className="text-[0.66rem] uppercase tracking-[0.22em] text-[var(--color-cellar)]">
                        {fmtDate(ev.startsOn)}
                      </p>
                    )}
                    <h3 className="mt-2 font-[family-name:var(--font-voces)] text-xl leading-tight">
                      {ev.title}
                    </h3>
                    {ev.summary && (
                      <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{ev.summary}</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <Link
              href="/events"
              className="mt-8 inline-block text-[0.72rem] uppercase tracking-[0.14em] text-[var(--cellar-ink)] hover:underline"
            >
              {t('allEvents')} →
            </Link>
          </div>
        </section>
      )}

      {inShop.length > 0 && (
        <section className="border-t border-[var(--surface-edge)] px-5 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
              {t('bottlesEyebrow')}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
              {t('bottlesHeading')}
            </h2>
            <p className="mt-4 max-w-prose text-[var(--text-muted)]">{t('bottlesBody')}</p>
            <ul className="mt-8 grid gap-x-10 sm:grid-cols-2">
              {inShop.map((w) => (
                <li key={w.id} className="border-b border-[var(--surface-edge)] py-3">
                  <p className="text-[0.92rem]">
                    {w.name}
                    {w.vintage ? <span className="text-[var(--text-muted)]"> {w.vintage}</span> : null}
                  </p>
                  <p className="text-[0.78rem] text-[var(--text-muted)]">
                    {w.producer}
                    {w.region ? ` · ${w.region}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
