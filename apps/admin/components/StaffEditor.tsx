'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDb } from '@/lib/supabase';
import { displayIdentity, MIN_PASSWORD } from '@/lib/identity';

type Permission = 'sold_out' | 'menu' | 'drinks' | 'bookings' | 'tables' | 'people' | 'marketing' | 'vouchers';

interface StaffRow {
  user_id: string;
  email: string;
  full_name: string | null;
  permissions: Permission[];
  active: boolean;
  created_at: string;
}

/**
 * One box per thing somebody can actually do, described in the words of the
 * room rather than the schema. The order is roughly least to most: the first
 * is what a new starter gets, the last is what hands over the keys.
 */
const RIGHTS: { key: Permission; label: string; note: string }[] = [
  { key: 'sold_out', label: 'Sold out', note: 'Mark a bottle or a dish gone, and put it back.' },
  { key: 'bookings', label: 'Bookings', note: 'See the diary, seat people, cancel.' },
  { key: 'drinks', label: 'Wine and bar list', note: 'Add, remove and re-price what is on the list.' },
  { key: 'menu', label: 'Food menu', note: 'Add, remove and re-price the food.' },
  { key: 'tables', label: 'Tables', note: 'The floor plan, the terrace switch, how long a table is held, which days are closed.' },
  { key: 'people', label: 'People', note: 'Add and remove staff, set PINs, tick these boxes.' },
  { key: 'marketing', label: 'Events', note: "Add, reorder and remove what's-on events on the site." },
  { key: 'vouchers', label: 'Gift vouchers', note: 'Take a voucher at the till, sell a paper one, cancel a refunded one.' },
];

const BLANK = {
  username: '',
  fullName: '',
  password: '',
  permissions: ['sold_out', 'bookings'] as Permission[],
};

export function StaffEditor() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  /*
   * Which row has its password box open, and what is in it. One at a time:
   * two open boxes on a phone is how the wrong person's password gets changed.
   */
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  /*
   * Password, On/Off and Remove happen rarely - once per person, mostly.
   * Edit (permissions) happens far more, so it stays a primary button and
   * these three sit behind a kebab instead of four identically-weighted
   * buttons fighting for the same row.
   */
  const [moreOpen, setMoreOpen] = useState<string | null>(null);

  /*
   * Which row has its permissions open for editing, and the draft while it
   * is. A tick used to write to the database the instant a thumb landed on
   * it - the row itself was the only guard against a mis-tap. Now the boxes
   * are read-only text until Edit is pressed, changes stay local until Save,
   * and Cancel throws the draft away. One row at a time, same reason as the
   * password box above.
   */
  const [editingRights, setEditingRights] = useState<string | null>(null);
  const [rightsDraft, setRightsDraft] = useState<Permission[]>([]);
  const [savingRights, setSavingRights] = useState(false);

  /**
   * Every call carries the caller's token; the route rejects anybody without
   * the people permission.
   *
   * The token is refreshed first if it is close to running out. Access tokens
   * last an hour, and this page is the kind of thing that sits open on a phone
   * behind the bar all evening - without this, the first thing somebody does
   * after a quiet hour fails, and the failure reads as a permissions problem
   * rather than as "sign in again".
   */
  const authed = useCallback(async (path: string, init: RequestInit = {}) => {
    const db = getDb();
    let { data } = await db.auth.getSession();

    const expiresAt = data.session?.expires_at;
    if (expiresAt && expiresAt * 1000 - Date.now() < 60_000) {
      const refreshed = await db.auth.refreshSession();
      if (refreshed.data.session) data = refreshed.data;
    }

    return fetch(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
    });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const { data: auth } = await getDb().auth.getUser();
    setMe(auth.user?.id ?? null);

    const res = await authed('/api/staff');
    const json = await res.json();
    if (!res.ok) setError(json.error ?? 'Could not load the staff list.');
    else setStaff(json.staff ?? []);
    setLoading(false);
  }, [authed]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await authed('/api/staff', { method: 'POST', body: JSON.stringify(draft) });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) return setError(json.error ?? 'Could not create that login.');
    setNotice(`${draft.username.trim().toLowerCase()} can sign in now. Give them the PIN in person, not by email.`);
    setDraft(BLANK);
    load();
  }

  function startEditRights(row: StaffRow) {
    setError(null);
    setEditingRights(row.user_id);
    setRightsDraft(row.permissions);
  }

  function cancelEditRights() {
    setEditingRights(null);
    setRightsDraft([]);
  }

  function toggleDraftRight(key: Permission, on: boolean) {
    setRightsDraft((prev) => (on ? [...prev, key] : prev.filter((p) => p !== key)));
  }

  /**
   * Writes the draft, and only the draft - nothing changes for this person
   * until this runs. The database still refuses the change that matters
   * (removing the last person who can manage people), so the worst a wrong
   * tick does before Save is need another tick.
   */
  async function saveRights(row: StaffRow) {
    setError(null);
    setSavingRights(true);

    const res = await authed('/api/staff', {
      method: 'PATCH',
      body: JSON.stringify({ userId: row.user_id, permissions: rightsDraft }),
    });
    setSavingRights(false);

    if (!res.ok) return setError((await res.json()).error ?? 'Could not change that.');

    setStaff((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, permissions: rightsDraft } : r)));
    setEditingRights(null);
    setRightsDraft([]);
    load();
  }

  async function setActive(row: StaffRow, active: boolean) {
    setError(null);
    setStaff((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, active } : r)));

    const res = await authed('/api/staff', {
      method: 'PATCH',
      body: JSON.stringify({ userId: row.user_id, active }),
    });
    if (!res.ok) setError((await res.json()).error ?? 'Could not change that.');
    load();
  }

  async function savePassword(row: StaffRow) {
    setError(null);
    setNotice(null);
    setBusy(true);

    const res = await authed('/api/staff', {
      method: 'PUT',
      body: JSON.stringify({ userId: row.user_id, password: newPassword }),
    });
    setBusy(false);

    if (!res.ok) return setError((await res.json()).error ?? 'Could not change that PIN.');

    // Cleared immediately: no reason for it to sit in a form on a shared phone.
    setNewPassword('');
    setResetting(null);
    setNotice(
      `New PIN set for ${displayIdentity(row.email)}. Tell them in person - they are signed out of nothing, but the old one has stopped working.`,
    );
  }

  async function remove(row: StaffRow) {
    if (!confirm(`Remove ${displayIdentity(row.email)}? They lose access immediately.`)) return;
    setError(null);
    const res = await authed(`/api/staff?userId=${encodeURIComponent(row.user_id)}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json()).error ?? 'Could not remove them.');
    load();
  }

  if (loading) return <p className="p-8 text-[var(--fs-body)] text-[var(--text-muted)]">Loading…</p>;

  return (
    <main className="admin-main">
      <h1 className="page-title">Who can get in</h1>
      <p className="page-dek">
        Only people with the People box ticked see this page. Every box is enforced by the database, so once you press Save
        below, unticking one actually removes that access - it does not just hide the buttons.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-md border border-[var(--surface-edge)] px-4 py-3 text-sm">{notice}</p>
      )}

      <ul className="card mt-6 divide-y divide-[var(--surface-edge)]">
        {staff.map((row) => (
          <li key={row.user_id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[var(--fs-emphasis)] font-medium">
                  {row.full_name || displayIdentity(row.email)}
                  {row.user_id === me && <span className="font-normal text-[var(--text-muted)]"> - you</span>}
                </p>
                {row.full_name && <p className="text-[var(--fs-label)] text-[var(--text-muted)]">{displayIdentity(row.email)}</p>}
              </div>

              {!row.active && <span className="chip chip-off">Off</span>}

              <button
                onClick={() =>
                  editingRights === row.user_id ? cancelEditRights() : startEditRights(row)
                }
                className="btn btn-primary min-h-11"
              >
                {editingRights === row.user_id ? 'Cancel' : 'Edit'}
              </button>

              <button
                onClick={() => setMoreOpen(moreOpen === row.user_id ? null : row.user_id)}
                aria-expanded={moreOpen === row.user_id}
                aria-label={`More actions for ${displayIdentity(row.email)}`}
                className="btn btn-quiet min-h-11 w-11 px-0 text-base"
              >
                ⋯
              </button>
            </div>

            {moreOpen === row.user_id && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--surface-edge)] pt-3">
                <button
                  onClick={() => {
                    setResetting(resetting === row.user_id ? null : row.user_id);
                    setNewPassword('');
                    setError(null);
                  }}
                  className="btn btn-quiet"
                >
                  {resetting === row.user_id ? 'Cancel' : 'PIN'}
                </button>

                <button
                  onClick={() => setActive(row, !row.active)}
                  disabled={row.user_id === me}
                  title={
                    row.user_id === me
                      ? 'You cannot switch yourself off'
                      : row.active
                        ? 'Switch off - keeps the login, blocks every screen'
                        : 'Switch back on'
                  }
                  className="btn btn-quiet"
                >
                  {row.active ? 'Switch off' : 'Switch on'}
                </button>

                <button
                  onClick={() => remove(row)}
                  disabled={row.user_id === me}
                  title={row.user_id === me ? 'You cannot remove yourself' : 'Remove'}
                  className="btn btn-quiet text-[var(--danger)]"
                >
                  Remove
                </button>
              </div>
            )}

            {editingRights === row.user_id ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {RIGHTS.map((right) => (
                  <label key={right.key} className="flex items-center gap-2 text-[0.82rem]" title={right.note}>
                    <input
                      type="checkbox"
                      checked={rightsDraft.includes(right.key)}
                      onChange={(e) => toggleDraftRight(right.key, e.target.checked)}
                      aria-label={`${right.label} for ${displayIdentity(row.email)}`}
                    />
                    {right.label}
                  </label>
                ))}
                <button
                  onClick={() => saveRights(row)}
                  disabled={savingRights}
                  className="btn btn-primary min-h-11"
                >
                  {savingRights ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[0.82rem] text-[var(--text-muted)]">
                {row.permissions.length > 0
                  ? RIGHTS.filter((r) => row.permissions.includes(r.key))
                      .map((r) => r.label)
                      .join(', ')
                  : 'No permissions yet.'}
              </p>
            )}

            {resetting === row.user_id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  savePassword(row);
                }}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <input
                  /*
                   * Readable when toggled, on purpose. A PIN nobody can see
                   * is a PIN nobody can read out to the person it belongs to
                   * - and the existing one genuinely cannot be shown, because
                   * Supabase stores a hash and not the digits. This is the
                   * only moment it is ever legible.
                   */
                  type={showPassword ? 'text' : 'password'}
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={MIN_PASSWORD}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value.replace(/\D/g, ''))}
                  placeholder={`New PIN for ${displayIdentity(row.email)}`}
                  autoComplete="new-password"
                  aria-label={`New PIN for ${displayIdentity(row.email)}`}
                  className="field flex-1"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="btn btn-quiet"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
                <button type="submit" disabled={busy} className="btn btn-primary">
                  {busy ? 'Saving…' : 'Set PIN'}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <section className="card mt-8 p-5">
        <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.12em]">Add someone</h2>

        <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            required
            type="text"
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            placeholder="Username - e.g. tawat"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="field"
          />
          <input
            value={draft.fullName}
            onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
            placeholder="Name (optional)"
            className="field"
          />
          <input
            required
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            minLength={MIN_PASSWORD}
            value={draft.password}
            onChange={(e) => setDraft({ ...draft, password: e.target.value.replace(/\D/g, '') })}
            placeholder={`Starting PIN - at least ${MIN_PASSWORD} digits`}
            autoComplete="new-password"
            className="field"
          />
          <fieldset className="sm:col-span-2">
            <legend className="text-[0.72rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              What they can do
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {RIGHTS.map((right) => (
                <label key={right.key} className="flex items-start gap-2 text-[0.85rem]">
                  <input
                    type="checkbox"
                    className="mt-[0.25rem]"
                    checked={draft.permissions.includes(right.key)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        permissions: e.target.checked
                          ? [...draft.permissions, right.key]
                          : draft.permissions.filter((p) => p !== right.key),
                      })
                    }
                  />
                  <span>
                    {right.label}
                    <span className="block text-[0.75rem] text-[var(--text-muted)]">{right.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" disabled={busy} className="btn btn-primary sm:col-span-2">
            {busy ? 'Creating…' : 'Create login'}
          </button>
        </form>

        <p className="mt-4 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
          Hand the PIN over in person and have them change it. Emailing a PIN means it
          sits in two inboxes forever.
        </p>
      </section>
    </main>
  );
}
