import { AuthGate } from '@/components/AuthGate';
import { SocialEditor } from '@/components/SocialEditor';

export const dynamic = 'force-dynamic';

export default function SocialPage() {
  return (
    <AuthGate>
      <SocialEditor />
    </AuthGate>
  );
}
