import { AuthGate } from '@/components/AuthGate';
import { VouchersScreen } from '@/components/VouchersScreen';

export const dynamic = 'force-dynamic';

/**
 * `?code=` is what the QR on the back of a voucher opens, so scanning one with
 * the bar phone lands straight on that voucher, ready to take money off.
 */
export default async function VouchersPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <AuthGate>
      <VouchersScreen initialCode={code ?? ''} />
    </AuthGate>
  );
}
