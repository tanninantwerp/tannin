'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readHub } from '@/lib/hub';

const MENUS = [
  { href: '/print/food', title: 'Food menu', sub: 'A5 portrait · recto/verso' },
  { href: '/print/night', title: 'Afterhours menu', sub: 'A5 portrait · single side' },
  { href: '/print/wine', title: 'Wine list', sub: 'A4 portrait · by section' },
];

export default function PrintHub() {
  // Back returns to whichever hub this tab came in through.
  const [home, setHome] = useState('/');
  useEffect(() => setHome(readHub()), []);

  return (
    <div style={{ maxWidth: '32rem', margin: '0 auto', color: '#f7f4ec' }}>
      <Link
        href={home}
        style={{
          display: 'inline-block',
          marginBottom: '1rem',
          color: '#b8b2a6',
          textDecoration: 'none',
          border: '1px solid rgba(168,198,194,0.25)',
          borderRadius: '6px',
          padding: '6px 12px',
          fontSize: '0.85rem',
        }}
      >
        ← Back
      </Link>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Print menus</h1>
      <p style={{ marginTop: '0.4rem', color: '#b8b2a6', fontSize: '0.9rem' }}>
        Each opens a print-ready page built from the live menu. Click Print on it, pick the paper
        size shown, and set margins to “Default”.
      </p>
      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {MENUS.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.9rem 1.1rem',
              background: '#161b1c',
              border: '1px solid rgba(168,198,194,0.18)',
              borderRadius: '8px',
              color: '#f7f4ec',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontWeight: 600 }}>{m.title}</span>
            <span style={{ color: '#9aa3a1', fontSize: '0.8rem' }}>{m.sub}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
