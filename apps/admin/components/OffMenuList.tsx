"use client";

export interface OffMenuItem {
  id: string;
  name: string;
  detail?: string | null;
  price?: number | null;
}

/**
 * What is kept but not on the menu right now, folded away under a section.
 *
 * Seasonal dishes, pours and bottles come back, so taking one off the menu
 * hides it from the website and the printed menus without deleting it. This
 * is where it waits, one click from coming back.
 */
export function OffMenuList({
  items,
  onRestore,
}: {
  items: OffMenuItem[];
  onRestore: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[var(--fs-label)] text-[var(--text-muted)]">
        Not on the menu ({items.length})
      </summary>
      <ul className="mt-2 flex flex-col">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 border-b border-[var(--surface-edge)] py-2 opacity-70 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{item.name}</div>
              {item.detail && (
                <div className="truncate text-[var(--fs-label)] italic text-[var(--text-muted)]">
                  {item.detail}
                </div>
              )}
            </div>
            {item.price != null && (
              <span className="shrink-0 tabular-nums">
                {String(item.price).replace(".", ",")}
              </span>
            )}
            <button
              onClick={() => onRestore(item.id)}
              className="btn btn-quiet shrink-0"
              title="Put back on the menu"
            >
              Put back
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
