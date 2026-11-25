import { AuthGate } from '@/components/AuthGate';
import { OrderEditor } from '@/components/OrderEditor';

export const dynamic = 'force-dynamic';

export default function OrderPage() {
  return (
    <AuthGate>
      <OrderEditor />
    </AuthGate>
  );
}
