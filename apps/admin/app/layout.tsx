import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ta-nnin - admin',
  // Belt and braces alongside the X-Robots-Tag header in next.config.
  robots: { index: false, follow: false },
};

/*
 * Duplicated from lib/theme.ts rather than imported: this has to run before
 * React hydrates or the page paints dark and then jumps to light (or the
 * reverse) a moment later. `beforeInteractive` guarantees that ordering; a
 * regular import of a client module does not. Keep the hour window in sync
 * with LIGHT_START_HOUR/LIGHT_END_HOUR there if it ever changes.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('tannin-admin-theme');
    var mode = stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
    var theme = mode;
    if (mode === 'auto') {
      var hour = new Date().getHours();
      theme = hour >= 8 && hour < 19 ? 'light' : 'dark';
    }
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
`;

/*
 * suppressHydrationWarning on this one attribute only: the theme script
 * below sets data-theme on this element before React hydrates, on purpose,
 * so the server-rendered markup (which has no data-theme - the server does
 * not know the visitor's local hour) will never match the client's first
 * paint. That mismatch is expected and static; it does not suppress
 * warnings about anything else on the page.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
