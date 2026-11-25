import { AuthGate } from '@/components/AuthGate';
import { EventsEditor } from '@/components/EventsEditor';

export const dynamic = 'force-dynamic';

export default function EventsPage() {
  return (
    <AuthGate>
      <EventsEditor />
    </AuthGate>
  );
}
