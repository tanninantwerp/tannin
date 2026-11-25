import { AuthGate } from '@/components/AuthGate';
import { TablesScreen } from '@/components/TablesScreen';

export const dynamic = 'force-dynamic';

export default function TablesPage() {
  return (
    <AuthGate>
      <TablesScreen />
    </AuthGate>
  );
}
