import { createHash } from 'node:crypto';

/**
 * Who is calling, as a hash, for the booking throttle.
 *
 * The throttle needs to answer one question - "is this the same caller again"
 * - and an address is far more than that question needs. A visitor's IP is
 * personal data under the GDPR, the bar has no reason to hold it, and holding
 * it would mean a subject access request had something to find. A hash answers
 * the question exactly as well and leaves nothing to disclose.
 *
 * The salt is what makes that true. An unsalted hash of an IPv4 address is not
 * anonymous in any useful sense: there are only four billion of them, so the
 * whole space can be hashed and looked up in about as long as it takes to
 * write the script. Without a salt configured this returns null and the
 * throttle falls back to the guest's email address alone - weaker, but honest.
 * Set THROTTLE_SALT to any long random string; see docs/SETUP.md.
 */
export function clientKey(request: Request): string | null {
  const salt = process.env.THROTTLE_SALT?.trim();
  if (!salt) return null;

  /*
   * Vercel sets `x-forwarded-for` itself and the leftmost entry is the real
   * peer. Trusting a header sounds wrong, and would be if we were behind
   * nothing - a caller can send whatever they like. Behind Vercel the platform
   * overwrites it, and behind nothing there is no throttle worth having
   * anyway.
   */
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim();
  if (!ip) return null;

  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}
