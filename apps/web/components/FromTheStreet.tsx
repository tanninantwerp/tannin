import { useTranslations } from 'next-intl';
import type { CurrentStory, SocialPost } from '@tannin/supabase';

export function FromTheStreet({
  posts,
  story,
}: {
  posts: readonly SocialPost[];
  story?: CurrentStory | null;
}) {
  const t = useTranslations('events');
  const hasContent = story || posts.length > 0;
  if (!hasContent) return null;

  return (
    <section className="bg-[var(--color-ink)] px-5 py-16 text-[var(--color-paper)] sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-[0.62rem] uppercase tracking-[0.28em] text-[var(--color-green-pale)]">
          {t('fromStreet')}
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {story && (
            <a
              href={story.href || `https://www.instagram.com/${story.account.replace('@', '')}/`}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden"
            >
              {/*
                Story ring - the gradient border matching Instagram's look.

                The square comes from the image's own `aspect-square`, not from
                the wrapper, and the image is `block`. Both matter, and the ring
                was visibly wrong on iOS without them:

                - the wrapper used to be `aspect-square` with the image inside
                  at `h-full`. A percentage height against a parent sized only
                  by `aspect-ratio` is not a definite height in Safari, so the
                  image fell back to its intrinsic height and the ring came out
                  uneven;
                - an `<img>` is inline by default, so it sits on the text
                  baseline and leaves descender space beneath it - which here
                  was a stripe of raw gradient along the bottom edge.

                Sizing the image itself sidesteps both: its height derives from
                its own width, and nothing resolves a percentage. The inner
                wrapper exists only to clip the hover scale, so the ring cannot
                be covered by the image growing over it.
              */}
              <div
                className="rounded-sm p-[2px]"
                style={{
                  background:
                    'linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                }}
              >
                <div className="overflow-hidden rounded-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={story.imageUrl}
                    alt=""
                    className="block aspect-square w-full object-cover transition duration-300 group-hover:opacity-85 group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="mt-2.5">
                <p className="text-[0.57rem] uppercase tracking-[0.2em] text-[var(--color-green-pale)]">
                  {story.account} · story
                </p>
                <p className="mt-1 text-[0.82rem] leading-snug text-[var(--color-paper)]/60">
                  Live now
                </p>
              </div>
            </a>
          )}

          {posts.map((post) => (
            <a
              key={post.id}
              href={post.href}
              target="_blank"
              rel="noreferrer"
              className="group block overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.imageUrl}
                alt=""
                className="aspect-square w-full object-cover transition duration-300 group-hover:opacity-85 group-hover:scale-[1.02]"
                loading="lazy"
              />
              <div className="mt-2.5">
                <p className="text-[0.57rem] uppercase tracking-[0.2em] text-[var(--color-green-pale)]">
                  {post.label}
                </p>
                <p className="mt-1 text-[0.82rem] leading-snug text-[var(--color-paper)]/60">
                  {post.title}
                </p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
