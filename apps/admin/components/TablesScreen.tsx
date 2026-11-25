'use client';

import { useState } from 'react';
import { TablePlanEditor } from '@/components/TablePlanEditor';
import { FloorPlan } from '@/components/FloorPlan';

/*
 * List and Map are two views over the same table plan, sharing one header -
 * title left, the view toggle right, matching every other screen's top row.
 */
export function TablesScreen() {
  const [view, setView] = useState<'list' | 'map'>('map');

  return (
    <main className="admin-main">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Tables</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('list')} className={`btn ${view === 'list' ? 'btn-primary' : 'btn-quiet'}`}>
            List
          </button>
          <button onClick={() => setView('map')} className={`btn ${view === 'map' ? 'btn-primary' : 'btn-quiet'}`}>
            Map
          </button>
        </div>
      </div>

      {view === 'map' && (
        <p className="page-dek">
          Drag a table to reposition it; the panel edits shape, seating direction, and which tables
          push together. Seats, minimum party, and area come from the List view.
        </p>
      )}

      {view === 'list' ? <TablePlanEditor /> : <FloorPlan />}
    </main>
  );
}
