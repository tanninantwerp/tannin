import { AuthGate } from '@/components/AuthGate';
import { PagesEditor } from '@/components/PagesEditor';

export const dynamic = 'force-dynamic';

export default function PagesPage() {
  return (
    <AuthGate>
      <PagesEditor />
    </AuthGate>
  );
}
