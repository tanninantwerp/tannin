import { Suspense } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { DayPlanChanges } from '@/components/DayPlanChanges';

export const dynamic = 'force-dynamic';

export default function DayPlanChangesPage() {
  return (
    <AuthGate>
      <main className="admin-main">
        {/* Reads `?date=` (the Day plan's "Make changes" link) via useSearchParams, which Next requires a Suspense boundary for. */}
        <Suspense fallback={null}>
          <DayPlanChanges />
        </Suspense>
      </main>
    </AuthGate>
  );
}
