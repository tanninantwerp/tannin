import { AuthGate } from '@/components/AuthGate';
import { ClosuresBody } from '@/components/ClosuresBody';

export const dynamic = 'force-dynamic';

export default function ClosuresPage() {
  return (
    <AuthGate>
      <ClosuresBody />
    </AuthGate>
  );
}
