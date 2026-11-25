'use client';

import { HoursExceptions } from '@/components/HoursExceptions';
import { HoursEditor } from '@/components/HoursEditor';

/**
 * Which closures screen to show, and the weekly hours under it.
 *
 * Ta-nnin's own admin gets the opening-hours exceptions (closed days, one-off
 * hours) - they book through Zenchef, so a booking-style closure means nothing
 * to them.
 */
export function ClosuresBody() {
  return (
    <>
      <HoursExceptions />
      <div className="admin-main pt-0">
        <HoursEditor />
      </div>
    </>
  );
}
