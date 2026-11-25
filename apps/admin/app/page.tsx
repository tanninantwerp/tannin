import { AuthGate } from '@/components/AuthGate';

// Nothing here is renderable without a signed-in session, so there is nothing
// worth prerendering.
export const dynamic = 'force-dynamic';

// The hub: logo, sign-out, and the tiles this person can use. No content of
// its own - see the comment on AuthGate's `variant` prop.
export default function AdminHome() {
  return <AuthGate variant="hub" />;
}
