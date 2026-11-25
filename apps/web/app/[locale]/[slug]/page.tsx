import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { fetchPageBySlug, type L10nText } from '@tannin/supabase';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { Markdown, plainText } from '@/lib/markdown';
import { serverDb } from '@/lib/server-db';
import { routing } from '@/i18n/routing';
import { LOCALE_TAG } from '@/i18n/tags';

/**
 * Pages staff add in Admin > Pages (a private-events page, a jobs page...).
 *
 * Any address the site does not already use lands here; one that is not a
 * published page is a normal 404. The site's own pages always win, because a
 * fixed route beats a dynamic one, and the admin refuses their addresses.
 */
export const revalidate = 30;

type Props = { params: Promise<{ locale: string; slug: string }> };

/** The reader's language, then English, then whatever was filled in. */
function pick(value: L10nText, locale: string): string {
  const own = value[locale as keyof L10nText]?.trim();
  if (own) return own;
  if (value.en?.trim()) return value.en.trim();
  return Object.values(value).find((v) => v?.trim())?.trim() ?? '';
}

async function load(slug: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  try {
    return await fetchPageBySlug(serverDb(), slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = await load(slug);
  if (!page) return {};
  const title = pick(page.seoTitle, locale) || pick(page.title, locale);
  const description = (pick(page.seoDescription, locale) || plainText(pick(page.body, locale))).slice(0, 160);
  const path = (l: string) => (l === routing.defaultLocale ? `/${slug}` : `/${l}/${slug}`);
  return {
    title,
    description,
    alternates: {
      canonical: path(locale),
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [LOCALE_TAG[l], path(l)])),
        'x-default': path(routing.defaultLocale),
      },
    },
    openGraph: { title, description, url: path(locale), ...(page.imageUrl ? { images: [page.imageUrl] } : {}) },
  };
}

export default async function CustomPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = await load(slug);
  if (!page) notFound();
  const title = pick(page.title, locale);

  return (
    <>
      <SiteNav />
      <main>
        <section className="relative isolate overflow-hidden bg-[var(--color-ink)] text-[var(--color-paper)]">
          {page.imageUrl && <Image src={page.imageUrl} alt="" fill sizes="100vw" unoptimized className="object-cover opacity-40" />}
          <div className="relative mx-auto max-w-3xl px-5 py-24 sm:py-32">
            <h1 className="font-[family-name:var(--font-voces)] text-4xl leading-tight sm:text-5xl">{title}</h1>
          </div>
        </section>
        <section className="mx-auto max-w-3xl px-5 py-20 sm:py-28">
          <Markdown text={pick(page.body, locale)} locale={locale} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
