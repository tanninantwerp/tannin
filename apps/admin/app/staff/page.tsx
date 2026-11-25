import { AuthGate } from '@/components/AuthGate';
import { StaffEditor } from '@/components/StaffEditor';

export const dynamic = 'force-dynamic';

export default function StaffPage() {
  return (
    <AuthGate>
      <StaffEditor />
    </AuthGate>
  );
}
