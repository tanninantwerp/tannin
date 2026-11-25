import { Suspense } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { BookingsBoard } from '@/components/BookingsBoard';

export const dynamic = 'force-dynamic';

export default function BookingsPage() {
  return (
    <AuthGate>
      {/* BookingsBoard reads `?date=` (the new-booking toast's link) via useSearchParams, which Next requires a Suspense boundary for. */}
      <Suspense fallback={null}>
        <BookingsBoard />
      </Suspense>
    </AuthGate>
  );
}
