# Tannin: status

**Updated:** 2026-11-25 18:15 CET (hosting move, cloud session). This repo (`tanninantwerp/Tannin`) is the new home. The old repo `szaidman55/Tannin` still exists and still deploys Vercel.

## State
- `tanninantwerp/Tannin` `main` is a fresh copy (no history) of old `main` plus the Cloudflare work from old PR #12, **without the pitch demo** (Sacha's choice, 2026-11-25): no `/demo` pages on web or admin, no demo mode, no demo QR codes, no demo-user seed script. The in-house booking code (`/book`, admin reservation screens) is still in the repo, just not linked.
- Nothing is connected to this repo yet: pushing `main` here deploys nothing.
- Vercel (old repo), the live Supabase `otkngcakummnuwnqnqvg` and DNS are untouched.
- Every issued voucher is a Stripe test purchase. The live Stripe account "Ta-nnin x Ce-llar" has no payments.

## Cloudflare (Workers Free, account of tannin@18diam.com)
- Deployed from Sacha's Mac on 2026-11-25: https://tannin-web.tannin.workers.dev and https://tannin-admin.tannin.workers.dev (crons 06:00 and 07:00 UTC on admin).
- Local clone for deploys: `~/Documents/GitHub/tannin-cloudflare` on the Mac. Wrangler for this account uses `XDG_CONFIG_HOME=~/.config/tannin-cf` (the default wrangler login is another account). Build variables: `source ~/.config/tannin-cf/build-env.sh`, then `npm run cf:deploy` in `apps/web` / `apps/admin` with `NEXT_PUBLIC_SITE_URL` set. The Mac's npm has `omit=dev`, so install with `npm ci --include=dev`.
- Tested 2026-11-25: all main pages 200 (home, en/nl/fr, wine, menu, drinks, events, gift, book, admin hub/print/closures/vouchers); `/demo` 404 on both.
- Builds still read the **old** Supabase (public keys only). Secrets are not loaded yet: Vercel marks them sensitive, so they can't be pulled.

## Needs Sacha
1. Fill `~/Documents/GitHub/tannin-cloudflare/secrets/web.env` and `admin.env` on the Mac (Supabase secret key, Stripe TEST secret key, booking email, Brevo key) and create a Stripe TEST webhook for `https://tannin-web.tannin.workers.dev/api/stripe/webhook` (events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired, charge.refunded). Then Claude loads them with `wrangler secret bulk`.
2. Workers Paid (5 USD/month) with the owner's card.
3. New Supabase project (EU) under the Tannin account, then data copy.
4. Hero decision (CE-LLAR logo, old branch `cellar-logo` in szaidman55/Tannin; not copied here).
5. Tawat's Stripe account and live keys. VAT treatment of vouchers with the accountant.

## Next steps
1. After secrets: test voucher PDF routes (web `/api/gift/pdf`, admin `/api/vouchers/pdf`), Stripe test checkout + webhook, Instagram sync, and check for CPU-limit errors (1102) on Free.
2. New Supabase, copy data, rebuild both Workers against it.
3. Connect this repo to Cloudflare Workers Builds (Git) so pushes deploy; set the weekly backup secret `SUPABASE_DB_URL`.
4. DNS for ta-nnin.be into Cloudflare, custom domains, move Stripe webhook and Instagram URLs. Checklist: `docs/hosting-cloudflare.md`.

## Watch out
- In the old repo `szaidman55/Tannin`, pushing `main` deploys Vercel. This repo deploys nothing yet.
- Commit messages and files carry no co-author trailers, session links or tool names.
- Worktree branches are never pushed as they are: rename or merge first.
- Never write secrets, keys or payment details here.
