import { AuthGate } from '@/components/AuthGate';
import { MenuEditor } from '@/components/MenuEditor';

export const dynamic = 'force-dynamic';

export default function MenuPage() {
  return (
    <AuthGate>
      <MenuEditor />
    </AuthGate>
  );
}
