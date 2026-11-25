import { AuthGate } from '@/components/AuthGate';
import { WineEditor } from '@/components/WineEditor';

export const dynamic = 'force-dynamic';

export default function WinePage() {
  return (
    <AuthGate>
      <WineEditor />
    </AuthGate>
  );
}
