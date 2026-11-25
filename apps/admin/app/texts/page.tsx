import { AuthGate } from '@/components/AuthGate';
import { TextsEditor } from '@/components/TextsEditor';

export const dynamic = 'force-dynamic';

export default function TextsPage() {
  return (
    <AuthGate>
      <TextsEditor />
    </AuthGate>
  );
}
