import { useTranslations } from 'next-intl';
import type { EventItem } from '@tannin/supabase';
import { EventImage } from './EventImage';

/**
 * What's-on for the public site.
 *
 * Split into what is still to come and the archive of what has been. Undated
 * events count as "coming up" - a standing thing rather than a past one; the
 * archive reads newest first.
 */
export function Events({ events = [] }: { events?: readonly EventItem[] }) {
  const t = useTranslations('events');

  // DD/MM/YYYY - plain and unambiguous, and it doesn't assert a weekday for the
  // dates that are still best-guesses from Instagram.
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => !e.startsOn || e.startsOn >= today);
  // The archive reads newest first - the last thing that happened, at the top.
  const past = events
    .filter((e) => e.startsOn && e.startsOn < today)
    .sort((a, b) => (b.startsOn ?? '').localeCompare(a.startsOn ?? ''));

  const HANDLE = { tannin: '@tannin_antwerp', cellar: '@cellar_antwerp' } as const;

  function card(ev: EventItem) {
    return (
      <article
        key={ev.id}
        className="overflow-hidden rounded-sm border border-[var(--surface-edge)] bg-[var(--color-bone)]"
      >
        {ev.imageUrl && (
          <EventImage imageUrl={ev.imageUrl} sourceUrl={ev.sourceUrl} />
        )}
        <div className="p-5">
          <p className="text-[0.66rem] uppercase tracking-[0.22em] text-[var(--accent)]">
            {t(`kind.${ev.kind}`)}
            {ev.startsOn ? ` · ${fmtDate(ev.startsOn)}` : ''}
          </p>
          <h3 className="mt-2 font-[family-name:var(--font-voces)] text-xl leading-tight">{ev.title}</h3>
          {ev.location && (
            <p className="mt-1 text-[0.8rem] text-[var(--text-muted)]">{ev.location}</p>
          )}
          {ev.summary && (
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{ev.summary}</p>
          )}
          {ev.body && <p className="mt-2 text-sm leading-relaxed">{ev.body}</p>}
          {ev.sourceUrl && (
            <a
              href={ev.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-[0.72rem] uppercase tracking-[0.14em] text-[var(--accent)] hover:underline"
            >
              {ev.sourceAccount ? `${t('seenOn')} ${HANDLE[ev.sourceAccount]}` : t('viewPost')} ↗
            </a>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[var(--text-muted)]">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight text-balance">
          {t('heading')}
        </h1>
        <p className="mt-4 max-w-prose text-[var(--text-muted)]">{t('standfirst')}</p>

        {events.length === 0 ? (
          <p className="mt-12 text-[var(--text-muted)]">{t('empty')}</p>
        ) : (
          <>
            {upcoming.length > 0 && (
              <div className="mt-12">
                <h2 className="menu-heading text-[0.72rem]">{t('upcoming')}</h2>
                <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {upcoming.map(card)}
                </div>
              </div>
            )}
            {past.length > 0 && (
              <details className="group mt-16">
                <summary className="menu-heading list-none cursor-pointer text-[0.72rem]">
                  {t('past')}
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                    ({past.length})
                  </span>
                  <span className="ml-1 text-[var(--text-muted)] group-open:hidden"> ↓</span>
                  <span className="ml-1 hidden text-[var(--text-muted)] group-open:inline"> ↑</span>
                </summary>
                <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{past.map(card)}</div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
