'use client';

import { useState } from 'react';

function shortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/**
 * Event card image. If the event came from Instagram (sourceUrl set), tapping
 * the image loads the post as an inline embed - Reels play as video, photos
 * show full-res. Without a sourceUrl it's just a plain image.
 */
export function EventImage({
  imageUrl,
  sourceUrl,
}: {
  imageUrl: string;
  sourceUrl?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const code = sourceUrl ? shortcode(sourceUrl) : null;

  if (expanded && code) {
    return (
      <div className="relative w-full bg-black" style={{ minHeight: 420 }}>
        <iframe
          src={`https://www.instagram.com/p/${code}/embed/`}
          className="w-full"
          style={{ minHeight: 420, border: 'none', display: 'block' }}
          allow="autoplay; encrypted-media"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={code ? 'group relative cursor-pointer' : undefined}
      onClick={code ? () => setExpanded(true) : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" className="w-full" loading="lazy" />
      {code && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" fill="white" className="h-6 w-6 translate-x-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
