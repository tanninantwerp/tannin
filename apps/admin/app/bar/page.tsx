import { AuthGate } from '@/components/AuthGate';
import { BarListEditor } from '@/components/BarListEditor';

export const dynamic = 'force-dynamic';

export default function BarPage() {
  return (
    <AuthGate>
      <BarListEditor />
    </AuthGate>
  );
}
