import './print.css';

// The print menus read public catalogue data (menu, wine, bar) - the same rows
// the website serves - so they need no sign-in. They open in their own tab,
// print, and close.
export const dynamic = 'force-dynamic';

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="print-root print-shell">{children}</div>;
}
