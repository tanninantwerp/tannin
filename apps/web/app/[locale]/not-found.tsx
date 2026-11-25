import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * Reached through the middleware rewrite, so it renders in whichever language
 * the visitor was already reading.
 */
export default function NotFound() {
  const t = useTranslations('notFound');

  return (
    <main className="flex min-h-svh flex-col justify-center px-5 py-24">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="font-[family-name:var(--font-voces)] text-[length:var(--text-section)] leading-tight">
          {t('heading')}
        </h1>
        <p className="mt-4 text-[var(--text-muted)]">{t('body')}</p>
        <div className="mt-8 flex flex-wrap gap-6 text-[0.72rem] uppercase tracking-[0.16em]">
          <Link href="/" className="border-b border-[var(--accent)] pb-1">
            {t('home')}
          </Link>
          <Link href="/drinks" className="border-b border-[var(--accent)] pb-1">
            {t('drinks')}
          </Link>
        </div>
      </div>
    </main>
  );
}
