'use client';

import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { formatPrice, type MenuItem, type MenuSection } from '@tannin/core';

/** Where the "scan me for drinks" QR points: the live bar list on the website. */
export function drinksUrl(): string {
  return 'https://tannin-web.vercel.app/drinks';
}

/** Screen-only bar across the top: a Print button and a size reminder. */
export function PrintToolbar({ title, size }: { title: string; size: string }) {
  return (
    <div className="print-toolbar no-print">
      <Link href="/print" className="print-back">
        ← Back
      </Link>
      <button className="print-btn" onClick={() => window.print()}>
        Print
      </button>
      <span style={{ fontWeight: 700 }}>{title}</span>
      <span className="print-hint">
        {size} · in the print dialog set paper to {size.split(' ')[0]} and margins to “Default”. Prints
        on your coloured stock - no background is printed.
      </span>
    </div>
  );
}

export function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brandmark" src="/brand/logo.png" alt="Ta-nnin" />;
}

function WineGlass() {
  return (
    <svg className="qr-glass" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 2h10l-1 7a4 4 0 0 1-4 3 4 4 0 0 1-4-3L7 2zm5 11v7m-3 0h6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Wine-glass mark, the QR, and the "scan me for drinks!" line beneath it. */
export function QrBlock({ size = 92 }: { size?: number }) {
  return (
    <div className="qr-block">
      <div className="qr-row">
        <WineGlass />
        <QRCodeSVG className="qr-code" value={drinksUrl()} size={size} level="M" marginSize={0} />
      </div>
      <span className="qr-cta">Scan me for drinks!</span>
    </div>
  );
}

/** One dish: NAME price on the bold line, italic note beneath. */
export function Dish({ item }: { item: MenuItem }) {
  return (
    <div className="dish">
      <div className="dish-line">
        <span className="dish-name">
          {item.name}
          {item.withCrackers ? ' *' : ''}
        </span>
        <span className="dish-price">{formatPrice(item.price)}</span>
      </div>
      {item.note && <div className="dish-note">{item.note}</div>}
    </div>
  );
}

/** A titled block of dishes. */
export function MenuBlock({ section }: { section: MenuSection }) {
  const items = section.items.filter((i) => !i.soldOut);
  if (items.length === 0) return null;
  return (
    <section style={{ breakInside: 'avoid', marginBottom: '20px' }}>
      <h2 className="sec-head">{section.title}</h2>
      {items.map((item) => (
        <Dish key={item.id} item={item} />
      ))}
    </section>
  );
}
