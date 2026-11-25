# Tannin: status

**Updated:** 2026-11-25 20:25 CET (hosting move, cloud session). This repo (`tanninantwerp/Tannin`) is the new home. The old repo `szaidman55/Tannin` still exists and still deploys Vercel.

## State
- In-house booking switched off 2026-11-25 (`IN_HOUSE_BOOKING_ENABLED = false` in packages/core/src/booking.ts): `/book` (all languages), the manage-booking page and the booking API answer 404, and `/book` is out of the sitemap. Code kept. Reserve goes to Zenchef.
- `tanninantwerp/Tannin` `main` is a fresh copy (no history) of old `main` plus the Cloudflare work from old PR #12, **without the pitch demo** (Sacha's choice, 2026-11-25): no `/demo` pages on web or admin, no demo mode, no demo QR codes, no demo-user seed script. The in-house booking code (`/book`, admin reservation screens) is still in the repo, just not linked.
- Nothing is connected to this repo yet: pushing `main` here deploys nothing.
- Vercel (old repo), the live Supabase `otkngcakummnuwnqnqvg` and DNS are untouched.
- **Stripe is LIVE on the Vercel site since 2026-11-25 ~19:20** (tannin-web.vercel.app, Production only; Preview stays on test): restricted live key `tannin-web` (rk_live, "full access except sensitive operations"), live publishable key, live webhook `tannin-web-vercel-live` -> https://tannin-web.vercel.app/api/stripe/webhook (4 events). Account Ta-nnin x Ce-llar (acct_1UVYtZC73Jjab0CZ). Checked: gift page serves pk_live, webhook rejects unsigned calls. Not yet proven with a real purchase. Vouchers 10000-10007 are test purchases.
- **Stripe is LIVE on Cloudflare too since 2026-11-25** (tannin-web.tannin.workers.dev): same rk_live key, live webhook `tannin-web-cloudflare-live` (we_1UfllpC73Jjab0CZZKHxFmem, 4 events), rebuilt with pk_live (`build-env.sh` now reads pk_live from `secrets/live.env`). Checked: build has only pk_live, webhook rejects unsigned (400), pages 200. Admin Worker has no Stripe key.

## Cloudflare (Workers Paid since 2026-11-25, account of tannin@18diam.com)
- **Admin Worker daily crons are OFF** (2026-11-25, `wrangler triggers deploy` with empty crons) so booking reminders don't go out twice while Vercel's crons still run. Any `cf:deploy` of admin turns them back on; that should happen only at go-live, together with pausing Vercel.
- Deployed from Sacha's Mac on 2026-11-25: https://tannin-web.tannin.workers.dev and https://tannin-admin.tannin.workers.dev (crons 06:00 and 07:00 UTC on admin).
- Local clone for deploys: `~/Documents/GitHub/tannin-cloudflare` on the Mac. Wrangler for this account uses `XDG_CONFIG_HOME=~/.config/tannin-cf` (the default wrangler login is another account). Build variables: `source ~/.config/tannin-cf/build-env.sh`, then `npm run cf:deploy` in `apps/web` / `apps/admin` with `NEXT_PUBLIC_SITE_URL` set. The Mac's npm has `omit=dev`, so install with `npm ci --include=dev`.
- Tested 2026-11-25: all main pages 200 (home, en/nl/fr, wine, menu, drinks, events, gift, book, admin hub/print/closures/vouchers); `/demo` 404 on both.
- Both Workers read the **old** Supabase. Secrets loaded 2026-11-25 from `secrets/{web,admin}.env` on the Mac (`wrangler secret bulk`, gitignored via .git/info/exclude): Supabase secret key, Stripe key + webhook (now live, see above), booking email, generated THROTTLE_SALT/REVALIDATE_SECRET/CRON_SECRET. BREVO_API_KEY (`tannin-cloudflare`, API key) loaded on both Workers 2026-11-25; Brevo IP blocking turned off (needed for Cloudflare); a test send via the API worked. Vercel still sends via SMTP.
- Tested on Free: a real Stripe test purchase (voucher 10007, 150 EUR, 2026-11-25) was activated by the new webhook, so payment + confirmation work. **The voucher PDF download fails on Free**: 5 of 12 parallel downloads hit `exceededCpu` (503) on fresh isolates; warm ones work (about 0.5 s). Sacha's own download failed this way. Fixed by Workers Paid (bought 2026-11-25 on Sacha's card, monthly; swap to the owner's card in Billing > Payment info): 24 of 24 parallel downloads OK. Stripe webhook rejects unsigned calls (400); admin voucher PDF refuses without login (403). Instagram sync runs but says no Instagram account is connected in the database: that is true on Vercel too (no INSTAGRAM_APP_ID/SECRET anywhere), so it has not been syncing.

## Needs Sacha
1. Later: move the Workers Paid billing to the owner's card.
3. New Supabase project (EU) under the Tannin account, then data copy.
4. Hero decision (CE-LLAR logo, old branch `cellar-logo` in szaidman55/Tannin; not copied here).
5. Confirm the live Stripe account is in the owner's name with the right bank account (payouts). VAT treatment of vouchers with the accountant. Optional: one small real purchase + refund to prove the live webhook.

## Next steps
1. Decide whether to connect Instagram (needs a Meta app ID/secret).
2. New Supabase, copy data, rebuild both Workers against it.
3. Connect this repo to Cloudflare Workers Builds (Git) so pushes deploy; set the weekly backup secret `SUPABASE_DB_URL`.
4. DNS for ta-nnin.be into Cloudflare (step 1: add zone + copy records + switch nameservers, no visible change; step 2 later: point the domains at the Workers, rebuild with NEXT_PUBLIC_SITE_URL=https://ta-nnin.be, turn crons on, pause Vercel), custom domains, move Stripe webhook and Instagram URLs. Checklist: `docs/hosting-cloudflare.md`.

## Watch out
- In the old repo `szaidman55/Tannin`, pushing `main` deploys Vercel. This repo deploys nothing yet.
- Commit messages and files carry no co-author trailers, session links or tool names.
- Worktree branches are never pushed as they are: rename or merge first.
- Never write secrets, keys or payment details here.
