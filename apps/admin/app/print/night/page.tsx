'use client';

import { useEffect, useState } from 'react';
import { fetchMenu } from '@tannin/supabase';
import { AFTERHOURS_STRAPLINE, formatPrice, type MenuItem } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { Logo, PrintToolbar, QrBlock } from '@/components/print/kit';

export default function NightPrint() {
  const [items, setItems] = useState<MenuItem[] | null>(null);

  useEffect(() => {
    fetchMenu(getDb())
      .then((all) =>
        // Every afterhours section, in admin order, as one flat list - the card
        // is a single run of dishes, not headed sections.
        setItems(
          all
            .filter((s) => s.service === 'afterhours')
            .flatMap((s) => s.items)
            .filter((i) => !i.soldOut),
        ),
      )
      .catch(() => setItems([]));
  }, []);

  const anyCrackers = (items ?? []).some((i) => i.withCrackers);

  return (
    <>
      <style>{`@page { size: A5 portrait; margin: 0; }`}</style>
      <PrintToolbar title="Afterhours (night) menu" size="A5 portrait" />
      {items === null ? (
        <p style={{ color: '#f7f4ec' }} className="no-print">
          Loading the menu…
        </p>
      ) : (
        <div
          className="sheet"
          style={{
            width: '148mm',
            minHeight: '210mm',
            padding: '10mm 12mm',
            overflow: 'visible',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ marginBottom: '8mm' }}>
            <Logo />
          </div>
          <p className="strapline" style={{ marginBottom: '8mm', textAlign: 'center' }}>
            The afterhours menu - {AFTERHOURS_STRAPLINE}
          </p>

          {/* Centered and spread down the page, as on the printed card. */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-evenly',
              textAlign: 'center',
            }}
          >
            {items.map((item) => (
              <div key={item.id}>
                <div className="dish-line" style={{ justifyContent: 'center' }}>
                  <span>
                    {item.name}
                    {item.withCrackers ? ' *' : ''}
                  </span>
                  <span className="dish-price">{formatPrice(item.price)}</span>
                </div>
                {item.note && (
                  <div className="dish-note" style={{ marginTop: '2px' }}>
                    {item.note}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: '8mm',
              marginTop: '6mm',
            }}
          >
            {anyCrackers ? (
              <p className="foot-box" style={{ maxWidth: '78mm' }}>
                * These afterhours dishes will be served with crackers
              </p>
            ) : (
              <span />
            )}
            <QrBlock size={84} />
          </div>
        </div>
      )}
    </>
  );
}
