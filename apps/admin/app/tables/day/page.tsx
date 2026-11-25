import { Suspense } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { DayPlan } from '@/components/DayPlan';

export const dynamic = 'force-dynamic';

export default function DayPlanPage() {
  return (
    <AuthGate>
      <main className="admin-main">
        {/* DayPlan reads `?date=` (Reservations' "Show map" link) via useSearchParams, which Next requires a Suspense boundary for. */}
        <Suspense fallback={null}>
          <DayPlan />
        </Suspense>
      </main>
    </AuthGate>
  );
}
