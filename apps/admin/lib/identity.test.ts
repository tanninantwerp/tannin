import { describe, expect, it } from 'vitest';
import { displayIdentity, passwordError, resolveIdentity, STAFF_DOMAIN } from './identity';

/**
 * The username-to-address mapping.
 *
 * Worth testing properly because it is the door. If this is not perfectly
 * stable, somebody who typed the same username they typed yesterday gets a
 * different address today and is simply told they do not exist - with no way
 * to tell that from a wrong password.
 */

describe('resolveIdentity', () => {
  it('builds the address from a bare username', () => {
    const id = resolveIdentity('tawat');
    expect(id).toEqual({ ok: true, address: `tawat@${STAFF_DOMAIN}`, kind: 'username' });
  });

  it('absorbs the capital a phone keyboard adds', () => {
    // The failure this prevents is invisible: `Tawat` would be a different
    // address, so a correct password would still be refused.
    for (const typed of ['Tawat', 'TAWAT', '  tawat  ', ' Tawat\t']) {
      const id = resolveIdentity(typed);
      expect(id.ok && id.address).toBe(`tawat@${STAFF_DOMAIN}`);
    }
  });

  it('passes a real email straight through', () => {
    // The way back in: an owner on an inbox that can actually be mailed.
    const id = resolveIdentity('Sacha@Gmail.com');
    expect(id).toEqual({ ok: true, address: 'sacha@gmail.com', kind: 'email' });
  });

  it('refuses usernames that are not typeable twice the same way', () => {
    for (const bad of ['', '   ', 'a', '9lives', '.tawat', 'ta wat', 'tawat!', 'ta@w@t', 'x'.repeat(33)]) {
      expect(resolveIdentity(bad).ok, bad).toBe(false);
    }
  });

  it('refuses a malformed address rather than making it a username', () => {
    // Contains @, so it is an attempt at an email; turning `tawat@` into a
    // username would silently create a second account for the same person.
    for (const bad of ['tawat@', '@ta-nnin.be', 'a@b']) {
      expect(resolveIdentity(bad).ok, bad).toBe(false);
    }
  });

  it('says what is wrong, without saying whether the account exists', () => {
    const id = resolveIdentity('9lives');
    expect(id.ok).toBe(false);
    expect(id.ok === false && id.reason).toMatch(/letter first/i);
  });

  it('accepts the punctuation a real name needs', () => {
    for (const ok of ['jan.peeters', 'marie-claire', 'bar_2', 'jp']) {
      expect(resolveIdentity(ok).ok, ok).toBe(true);
    }
  });
});

describe('passwordError', () => {
  it('accepts a digit-only PIN at the minimum length', () => {
    expect(passwordError('12345')).toBeNull();
  });

  it('refuses anything shorter than the minimum', () => {
    expect(passwordError('1234')).toMatch(/at least/i);
  });

  it('refuses a letter anywhere in it', () => {
    for (const bad of ['1234a', 'abcde', '12 34', '123-45']) {
      expect(passwordError(bad), bad).toMatch(/numbers only/i);
    }
  });
});

describe('displayIdentity', () => {
  it('hides the synthetic domain', () => {
    expect(displayIdentity(`tawat@${STAFF_DOMAIN}`)).toBe('tawat');
  });

  it('leaves a real address alone', () => {
    expect(displayIdentity('sacha@gmail.com')).toBe('sacha@gmail.com');
  });

  it('round-trips with resolveIdentity', () => {
    const id = resolveIdentity('marie-claire');
    expect(id.ok && displayIdentity(id.address)).toBe('marie-claire');
  });
});
