import { Suspense } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { ReservationsOverview } from '@/components/ReservationsOverview';

export const dynamic = 'force-dynamic';

export default function ReservationsPage() {
  return (
    <AuthGate>
      {/* ReservationsOverview reads `?date=` (the link back from Tonight's board) via useSearchParams, which Next requires a Suspense boundary for. */}
      <Suspense fallback={null}>
        <ReservationsOverview />
      </Suspense>
    </AuthGate>
  );
}
