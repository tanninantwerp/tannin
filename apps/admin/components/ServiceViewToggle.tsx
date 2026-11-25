import Link from 'next/link';

/**
 * The one control that makes Tonight's list and the floor map read as two views
 * of a single service, not two destinations. Each link carries the date, so
 * flipping List⇄Map stays on the same night.
 */
export function ServiceViewToggle({ view, date }: { view: 'list' | 'map'; date: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="List or map">
      <Link
        href={`/bookings?date=${date}`}
        className={`btn ${view === 'list' ? 'btn-primary' : 'btn-quiet'}`}
        aria-current={view === 'list' ? 'page' : undefined}
      >
        List
      </Link>
      <Link
        href={`/tables/day?date=${date}`}
        className={`btn ${view === 'map' ? 'btn-primary' : 'btn-quiet'}`}
        aria-current={view === 'map' ? 'page' : undefined}
      >
        Map
      </Link>
    </div>
  );
}
