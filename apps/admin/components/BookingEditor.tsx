'use client';

import { useEffect, useState } from 'react';
import { fetchBookingChanges, rescheduleBooking, updateBookingContact } from '@tannin/supabase';
import type { Booking, BookingArea, BookingChange, BookingStatus } from '@tannin/core';
import { getDb } from '@/lib/supabase';
import { AREAS } from '@/lib/dayStatus';

/** One line per changed field, in plain terms rather than raw column names. */
function summarizeField(field: string, change: { old: unknown; new: unknown }): string {
  switch (field) {
    case 'status':
      return `status: ${change.old ?? 'new'} → ${change.new}`;
    case 'party_size':
      return `party size: ${change.old} → ${change.new}`;
    case 'when': {
      const o = change.old as { date: string; time: string };
      const n = change.new as { date: string; time: string };
      return `time: ${o.date} ${o.time?.slice(0, 5)} → ${n.date} ${n.time?.slice(0, 5)}`;
    }
    case 'table_id':
    case 'joined_table_ids':
    case 'seat_indices':
      return 'seating changed';
    default:
      return field;
  }
}

function BookingHistory({ bookingId }: { bookingId: string }) {
  const [changes, setChanges] = useState<BookingChange[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBookingChanges(getDb(), bookingId)
      .then((c) => {
        if (!cancelled) setChanges(c);
      })
      .catch(() => {
        if (!cancelled) setChanges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!changes || changes.length === 0) return null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
        History ({changes.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {changes.map((c) => (
          <li key={c.id} className="text-xs text-[var(--text-muted)]">
            {new Date(c.changedAt).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            - {c.changedBy ?? 'guest'} - {Object.entries(c.changes).map(([f, v]) => summarizeField(f, v)).join(', ')}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Edit an existing booking in place - the thing staff had no way to do short of
 * cancelling and re-booking.
 *
 * Two kinds of change, kept apart because they cost different things:
 *  - Contact details (name, phone, e-mail, notes) never affect which table
 *    fits, so they save straight through row-level security.
 *  - Time, date, party size, and area change the shape of the booking, so they
 *    go through `reschedule_booking`, which re-runs the allocator and can hand
 *    back a `pending` if nothing free fits the new shape. Those fields only
 *    show for a booking still ahead of service - a seated or settled booking is
 *    history, and only its contact details can still be corrected.
 */
export function BookingEditor({
  booking,
  onSaved,
  onClose,
}: {
  booking: Booking;
  onSaved: (result?: { status: BookingStatus }) => void;
  onClose: () => void;
}) {
  const movable = booking.status === 'pending' || booking.status === 'confirmed';

  const [guestName, setGuestName] = useState(booking.guestName);
  const [guestPhone, setGuestPhone] = useState(booking.guestPhone ?? '');
  const [guestEmail, setGuestEmail] = useState(booking.guestEmail ?? '');
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time.slice(0, 5));
  const [party, setParty] = useState(String(booking.partySize));
  const [area, setArea] = useState<BookingArea | ''>(booking.area ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!guestName.trim()) return setError('Name is required.');

    const partySize = Number(party);
    const contactChanged =
      guestName.trim() !== booking.guestName ||
      guestPhone.trim() !== (booking.guestPhone ?? '') ||
      guestEmail.trim() !== (booking.guestEmail ?? '') ||
      notes.trim() !== (booking.notes ?? '');
    const moveChanged =
      movable &&
      (date !== booking.date ||
        time !== booking.time.slice(0, 5) ||
        partySize !== booking.partySize ||
        (area || undefined) !== booking.area);

    if (moveChanged && (!Number.isFinite(partySize) || partySize < 1 || partySize > 8)) {
      return setError('Party size has to be between 1 and 8.');
    }
    if (moveChanged && !time) return setError('Pick a time.');

    setSaving(true);
    try {
      if (contactChanged) {
        await updateBookingContact(getDb(), booking.id, {
          guestName: guestName.trim(),
          guestPhone: guestPhone.trim() || null,
          guestEmail: guestEmail.trim() || null,
          notes: notes.trim() || null,
        });
      }
      let status: BookingStatus | undefined;
      if (moveChanged) {
        status = await rescheduleBooking(getDb(), booking.id, {
          date,
          time,
          partySize,
          area: area || null,
        });
      }
      onSaved(status ? { status } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      setSaving(false);
    }
  }

  return (
    <div className="card mt-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Edit booking</p>
        {booking.refCode && <span className="text-xs text-[var(--text-muted)]">{booking.refCode}</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          autoFocus
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          placeholder="Name"
          aria-label="Guest name"
          className="field w-40"
        />
        <input
          value={guestPhone}
          onChange={(e) => setGuestPhone(e.target.value)}
          placeholder="Phone"
          aria-label="Guest phone"
          className="field w-36"
        />
        <input
          value={guestEmail}
          onChange={(e) => setGuestEmail(e.target.value)}
          placeholder="Email"
          aria-label="Guest email"
          className="field w-48"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (allergies, occasion…)"
          aria-label="Notes"
          className="field w-56"
        />
      </div>

      {movable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Date"
            className="field w-auto"
          />
          <input
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Time"
            className="field w-auto"
          />
          <input
            inputMode="numeric"
            value={party}
            onChange={(e) => setParty(e.target.value)}
            placeholder="Party"
            aria-label="Party size"
            className="field w-16"
          />
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as BookingArea | '')}
            aria-label="Area preference"
            className="field w-32"
          >
            <option value="">Any area</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--text-muted)]">
            Changing time, day, party or area re-checks a table.
          </span>
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          This booking is {booking.status.replace('_', ' ')} - only its contact details can be changed.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose} disabled={saving} className="btn btn-quiet">
          Cancel
        </button>
      </div>

      <BookingHistory bookingId={booking.id} />
    </div>
  );
}
