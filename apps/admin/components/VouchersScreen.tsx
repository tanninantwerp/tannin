'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { normaliseVoucherCode, parseEuroInput, voucherAmountLabel, voucherDateLabel } from '@tannin/core';
import { getDb } from '@/lib/supabase';

interface Voucher {
  id: string;
  code: string;
  amount_cents: number;
  balance_cents: number;
  status: 'active' | 'void';
  source: 'online' | 'bar';
  recipient_name: string | null;
  from_name: string | null;
  note: string | null;
  buyer_email: string | null;
  valid_until: string;
  created_at: string;
  void_reason: string | null;
}

interface Redemption {
  id: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
}

type Filter = 'open' | 'used' | 'expired' | 'void' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'used', label: 'Used up' },
  { key: 'expired', label: 'Expired' },
  { key: 'void', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

/** What each refusal from the database means, in words for the bar. */
const REFUSALS: Record<string, string> = {
  TN010: 'No voucher with that code.',
  TN011: 'This voucher has been cancelled.',
  TN012: 'This voucher has expired.',
  TN013: 'Enter the amount to take off.',
  TN014: 'That is more than is left on the voucher.',
  '42501': 'Your login cannot take vouchers. Ask for the Gift vouchers permission on the People screen.',
};

const euro = (cents: number) => `€ ${voucherAmountLabel(cents)}`;

/** Today in Antwerp, as the database counts it, so "expired" agrees with the till. */
function todayBrussels(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
}

function stateOf(v: Voucher, today: string): Exclude<Filter, 'all'> {
  if (v.status === 'void') return 'void';
  if (v.balance_cents === 0) return 'used';
  if (v.valid_until < today) return 'expired';
  return 'open';
}

const STATE_LABEL: Record<Exclude<Filter, 'all'>, string> = {
  open: 'Open',
  used: 'Used up',
  expired: 'Expired',
  void: 'Cancelled',
};

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }).format(new Date(iso));

/**
 * Gift vouchers at the till.
 *
 * Three jobs, in the order they happen behind the bar: take a voucher (scan
 * the QR or type the code, take an amount off), sell a paper one, and look
 * back over the register. Every change goes through a database function that
 * checks the balance under a lock, so this screen never does the arithmetic
 * that matters - it only shows the answer.
 */
export function VouchersScreen({ initialCode }: { initialCode: string }) {
  const [rows, setRows] = useState<Voucher[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const today = todayBrussels();

  // Redeem
  const [codeInput, setCodeInput] = useState(initialCode);
  const [current, setCurrent] = useState<Voucher | null>(null);
  const [history, setHistory] = useState<Redemption[]>([]);
  const [amountInput, setAmountInput] = useState('');
  const [redeemNote, setRedeemNote] = useState('');

  // Sell a paper voucher
  const [selling, setSelling] = useState(false);
  const [sale, setSale] = useState({ amount: '', recipient: '', from: '', note: '' });

  const load = useCallback(async () => {
    const { data, error: e } = await getDb()
      .from('gift_vouchers')
      .select('*')
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(500);
    if (e) setError(e.message);
    else setRows((data ?? []) as Voucher[]);
  }, []);

  const open = useCallback(async (code: string) => {
    setError(null);
    setNotice(null);
    const normal = normaliseVoucherCode(code);
    if (!normal) {
      setCurrent(null);
      setError('That is not a voucher code. They are five digits, like 10023.');
      return;
    }
    const { data } = await getDb()
      .from('gift_vouchers')
      .select('*')
      .eq('code', normal)
      .neq('status', 'pending')
      .maybeSingle();
    if (!data) {
      setCurrent(null);
      setError(REFUSALS.TN010!);
      return;
    }
    setCurrent(data as Voucher);
    setCodeInput(normal);
    const { data: spent } = await getDb()
      .from('gift_voucher_redemptions')
      .select('id, amount_cents, note, created_at')
      .eq('voucher_id', (data as Voucher).id)
      .order('created_at', { ascending: false });
    setHistory((spent ?? []) as Redemption[]);
  }, []);

  useEffect(() => {
    void load();
    if (initialCode) void open(initialCode);
  }, [load, open, initialCode]);

  async function redeem() {
    if (!current) return;
    const cents = parseEuroInput(amountInput);
    if (!cents) return setError(REFUSALS.TN013!);
    setBusy(true);
    setError(null);
    const { data, error: e } = await getDb().rpc('redeem_gift_voucher', {
      in_code: current.code,
      in_amount_cents: cents,
      in_note: redeemNote,
    });
    setBusy(false);
    if (e) return setError(REFUSALS[e.code ?? ''] ?? e.message);
    const after = (Array.isArray(data) ? data[0] : data) as Voucher;
    setNotice(`${euro(cents)} taken off ${after.code}. ${euro(after.balance_cents)} left.`);
    setAmountInput('');
    setRedeemNote('');
    await open(after.code);
    await load();
  }

  async function issue() {
    const cents = parseEuroInput(sale.amount);
    if (!cents || cents < 500 || cents > 300000) return setError('Enter a value between 5 and 3000 euros.');
    setBusy(true);
    setError(null);
    const { data, error: e } = await getDb().rpc('issue_gift_voucher', {
      in_amount_cents: cents,
      in_recipient: sale.recipient,
      in_from: sale.from,
      in_note: sale.note,
    });
    setBusy(false);
    if (e) return setError(REFUSALS[e.code ?? ''] ?? e.message);
    const v = (Array.isArray(data) ? data[0] : data) as Voucher;
    setSale({ amount: '', recipient: '', from: '', note: '' });
    setSelling(false);
    setNotice(`Sold ${v.code} for ${euro(v.amount_cents)}. Ring it up on the till, then print the card.`);
    await load();
    await open(v.code);
  }

  async function cancel(v: Voucher) {
    const reason = window.prompt(`Cancel ${v.code}? It can no longer be spent. Why (refund, lost, mistake)?`);
    if (reason === null) return;
    setBusy(true);
    const { error: e } = await getDb().rpc('void_gift_voucher', { in_id: v.id, in_reason: reason });
    setBusy(false);
    if (e) return setError(REFUSALS[e.code ?? ''] ?? e.message);
    setNotice(`${v.code} cancelled.`);
    await load();
    if (current?.id === v.id) await open(v.code);
  }

  async function downloadPdf(v: Voucher) {
    setError(null);
    const { data } = await getDb().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return setError('Signed out - sign in again.');
    const res = await fetch(`/api/vouchers/pdf?id=${v.id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return setError('Could not make the PDF.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `ta-nnin-gift-voucher-${v.code}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shown = useMemo(
    () => (rows ?? []).filter((v) => filter === 'all' || stateOf(v, today) === filter),
    [rows, filter, today],
  );

  // What is still owed in drinks: the number the accountant asks for.
  const outstanding = useMemo(
    () => (rows ?? []).filter((v) => stateOf(v, today) === 'open').reduce((sum, v) => sum + v.balance_cents, 0),
    [rows, today],
  );

  const currentState = current ? stateOf(current, today) : null;

  return (
    <main className="admin-main">
      <h1 className="page-title">Gift vouchers</h1>
      <p className="page-dek">
        Scan the QR on the back of a voucher, or type its code, then take off what was spent. What is left stays
        on the voucher for next time.
      </p>

      {error && <p className="mt-4 text-[var(--fs-body)] text-[var(--danger)]">{error}</p>}
      {notice && <p className="mt-4 text-[var(--fs-body)]">{notice}</p>}

      {/* Take a voucher */}
      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void open(codeInput);
        }}
      >
        <input
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="10023"
          aria-label="Voucher code"
          autoCapitalize="characters"
          autoComplete="off"
          className="field min-h-11 flex-1 uppercase tracking-[0.08em]"
        />
        <button type="submit" className="btn btn-primary min-h-11">
          Find
        </button>
      </form>

      {current && currentState && (
        <div className="card mt-4 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[0.95rem] font-semibold tracking-[0.06em]">{current.code}</p>
            <p className="text-[var(--fs-label)] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {STATE_LABEL[currentState]}
            </p>
          </div>
          <p className="mt-3 text-3xl font-semibold tabular-nums">
            {euro(current.balance_cents)}
            <span className="ml-2 text-[var(--fs-label)] font-normal text-[var(--text-muted)]">
              left of {euro(current.amount_cents)}
            </span>
          </p>
          <p className="mt-2 text-[var(--fs-label)] text-[var(--text-muted)]">
            {current.recipient_name ? `For ${current.recipient_name}` : 'No name'}
            {current.from_name ? ` · from ${current.from_name}` : ''} · valid until{' '}
            {voucherDateLabel(current.valid_until)} · {current.source === 'online' ? 'bought online' : 'sold at the bar'}
          </p>
          {current.status === 'void' && current.void_reason && (
            <p className="mt-2 text-[var(--fs-label)] text-[var(--danger)]">Cancelled: {current.void_reason}</p>
          )}

          {currentState === 'open' && (
            <form
              className="mt-4 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void redeem();
              }}
            >
              <input
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Amount, e.g. 32,50"
                aria-label="Amount to take off"
                inputMode="decimal"
                className="field min-h-11 w-40"
              />
              <input
                value={redeemNote}
                onChange={(e) => setRedeemNote(e.target.value)}
                placeholder="Note (optional)"
                aria-label="Note"
                maxLength={160}
                className="field min-h-11 flex-1"
              />
              <button type="submit" disabled={busy} className="btn btn-primary min-h-11">
                Take off
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAmountInput(voucherAmountLabel(current.balance_cents))}
                className="btn btn-quiet min-h-11"
              >
                All of it
              </button>
            </form>
          )}

          {history.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 border-t border-[var(--surface-edge)] pt-3 text-[var(--fs-label)] text-[var(--text-muted)]">
              {history.map((r) => (
                <li key={r.id}>
                  {shortDate(r.created_at)} · {euro(r.amount_cents)}
                  {r.note ? ` · ${r.note}` : ''}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void downloadPdf(current)} className="btn btn-quiet min-h-11">
              Print card (PDF)
            </button>
            {current.status === 'active' && (
              <button type="button" disabled={busy} onClick={() => void cancel(current)} className="btn btn-quiet min-h-11">
                Cancel voucher
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sell a paper voucher */}
      <div className="mt-8">
        {selling ? (
          <div className="card p-4">
            <p className="text-[0.9rem] font-medium">Sell a voucher at the bar</p>
            <p className="mt-1 text-[var(--fs-label)] text-[var(--text-muted)]">
              Take the money on the till as usual, then make the voucher here so it gets a code and is in the
              register. Valid 12 months.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={sale.amount}
                onChange={(e) => setSale({ ...sale, amount: e.target.value })}
                placeholder="Value in euros, e.g. 50"
                aria-label="Value"
                inputMode="decimal"
                className="field min-h-11"
                autoFocus
              />
              <input
                value={sale.recipient}
                onChange={(e) => setSale({ ...sale, recipient: e.target.value })}
                placeholder="A gift for (optional)"
                aria-label="A gift for"
                maxLength={60}
                className="field min-h-11"
              />
              <input
                value={sale.from}
                onChange={(e) => setSale({ ...sale, from: e.target.value })}
                placeholder="From (optional)"
                aria-label="From"
                maxLength={60}
                className="field min-h-11"
              />
              <input
                value={sale.note}
                onChange={(e) => setSale({ ...sale, note: e.target.value })}
                placeholder="Note (optional, keep it short)"
                aria-label="Note"
                maxLength={70}
                className="field min-h-11"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void issue()} className="btn btn-primary min-h-11">
                Make voucher
              </button>
              <button type="button" onClick={() => setSelling(false)} className="btn btn-quiet min-h-11">
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setSelling(true)} className="btn btn-quiet min-h-11">
            Sell a voucher at the bar
          </button>
        )}
      </div>

      {/* The register */}
      <h2 className="mt-10 text-[0.9rem] font-semibold uppercase tracking-[0.1em]">Register</h2>
      <p className="mt-1 text-[var(--fs-label)] text-[var(--text-muted)]">
        Still to be spent on open vouchers: <span className="font-semibold text-[var(--text)]">{euro(outstanding)}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`btn min-h-9 px-3 ${filter === f.key ? 'btn-primary' : 'btn-quiet'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">Nothing here.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {shown.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => {
                  void open(v.code);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="card flex w-full items-center gap-3 p-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9rem] font-medium tracking-[0.04em]">{v.code}</p>
                  <p className="truncate text-[var(--fs-label)] text-[var(--text-muted)]">
                    {v.recipient_name ?? 'No name'} · {v.source === 'online' ? 'online' : 'bar'} · until{' '}
                    {voucherDateLabel(v.valid_until)}
                  </p>
                </div>
                <p className="text-right text-[0.9rem] tabular-nums">
                  {euro(v.balance_cents)}
                  <span className="block text-[var(--fs-label)] text-[var(--text-muted)]">of {euro(v.amount_cents)}</span>
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
