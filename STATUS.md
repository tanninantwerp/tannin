# Tannin: status

**Updated:** 2026-11-25 23:50 CET (content editor from 58diamonds LIVE: PR #1 merged, migration 0055 run, both Workers deployed).

## State
- **Content editor LIVE since 2026-11-25 ~23:45 CET** (PR #1, ported from 58diamonds): admin tiles Texts (all 353 website texts in EN/NL/FR, search, 'missing a language' filter, Original, DeepL Translate) and Pages (new pages at /<slug>, /nl/<slug>, /fr/<slug>, Markdown text, photo, footer link, sitemap). Needs the `marketing` permission. Messages now live in `packages/content/messages`. Migration 0055 (`site_texts`, `pages`) run on the live Supabase. DeepL API Free key `DEEPL_API_KEY` on the admin Worker (also in `secrets/admin.env`). Checked live: a test page and a French text edit showed on ta-nnin.be and went away when deleted; anon can read, not write; /texts and /pages answer 200. Not yet tried signed in.
- **ta-nnin.be is LIVE on Cloudflare since 2026-11-25 ~21:50 CET** (replaced the old WordPress site). Registrar Easyhost; nameservers alexia/donovan.ns.cloudflare.com (zone in the Tannin Cloudflare account; the old zone sat in a third-party Cloudflare account). Worker custom domains: ta-nnin.be + www.ta-nnin.be -> tannin-web, admin.ta-nnin.be -> tannin-admin (in `wrangler.jsonc`, workers.dev kept on). Redirect rule www -> apex (301). Old WordPress URLs redirect (next.config.mjs: /about-us, /contact, /food-menu, /wine-menu, /jobs). Checked: pages 200, webhook 400 unsigned, admin 200 on the new nameservers (some resolvers still cached 'no admin' at 22:05).
- Live Stripe webhook renamed `tannin-web-live`, now -> https://ta-nnin.be/api/stripe/webhook (same secret). Both Workers rebuilt with NEXT_PUBLIC_SITE_URL/WEB_URL=https://ta-nnin.be and ADMIN_URL=https://admin.ta-nnin.be. Admin crons are back ON (reminders are harmless: booking is off).
- **Live site is on the NEW Supabase since 2026-11-25** (`vbtscmnskepilywenquu`, eu-central-1, under the Tannin account). Schema = the 54 migrations; data, 6 auth users (same passwords) and the 11 `media` files copied from the old project; counts matched old vs new right before the switch; 6 image links rewritten to the new project. Both Workers rebuilt (`build-env.sh` reads the new URL + publishable key from `secrets/supabase.env`) and given the new `SUPABASE_SECRET_KEY`. Checked: pages, event images, wine list, voucher PDF (service key) all OK; admin bundle points at the new project.
- **Vercel (tannin-web.vercel.app) = Sacha's DEMO** on the OLD Supabase `otkngcakummnuwnqnqvg`, which stays as it is. Back on Stripe TEST in Production since 2026-11-25 (sk_test, pk_test, test webhook `tannin-web-vercel-demo-test` we_1Ufk5i… -> tannin-web.vercel.app). The old live webhook `tannin-web-vercel-live` is DISABLED (not deleted).
- In-house booking switched off 2026-11-25 (`IN_HOUSE_BOOKING_ENABLED = false` in packages/core/src/booking.ts): `/book` (all languages), the manage-booking page and the booking API answer 404, and `/book` is out of the sitemap. Code kept. Reserve goes to Zenchef.
- `tanninantwerp/Tannin` `main` is a fresh copy (no history) of old `main` plus the Cloudflare work from old PR #12, **without the pitch demo** (Sacha's choice, 2026-11-25): no `/demo` pages on web or admin, no demo mode, no demo QR codes, no demo-user seed script. The in-house booking code (`/book`, admin reservation screens) is still in the repo, just not linked.
- Nothing is connected to this repo yet: pushing `main` deploys nothing; deploy from the Mac.
- Stripe live: account Ta-nnin x Ce-llar (acct_1UVYtZC73Jjab0CZ), restricted key rk_live `tannin-web`. Only ta-nnin.be takes live payments now. Vouchers 10000-10007 are test purchases.
- **Stripe is LIVE on Cloudflare too since 2026-11-25** (tannin-web.tannin.workers.dev): same rk_live key, live webhook `tannin-web-cloudflare-live` (we_1UfllpC73Jjab0CZZKHxFmem, 4 events), rebuilt with pk_live (`build-env.sh` now reads pk_live from `secrets/live.env`). Checked: build has only pk_live, webhook rejects unsigned (400), pages 200. Admin Worker has no Stripe key.

## Cloudflare (Workers Paid since 2026-11-25, account of tannin@18diam.com)
- Deployed from Sacha's Mac on 2026-11-25: https://tannin-web.tannin.workers.dev and https://tannin-admin.tannin.workers.dev (crons 06:00 and 07:00 UTC on admin).
- Local clone for deploys: `~/Documents/GitHub/tannin-cloudflare` on the Mac. Wrangler for this account uses `XDG_CONFIG_HOME=~/.config/tannin-cf` (the default wrangler login is another account). Build variables: `source ~/.config/tannin-cf/build-env.sh`, then `npm run cf:deploy` in `apps/web` / `apps/admin` with `NEXT_PUBLIC_SITE_URL` set. The Mac's npm has `omit=dev`, so install with `npm ci --include=dev`.
- Tested 2026-11-25: all main pages 200 (home, en/nl/fr, wine, menu, drinks, events, gift, book, admin hub/print/closures/vouchers); `/demo` 404 on both.
- Both Workers read the **new** Supabase (see State). Secrets loaded 2026-11-25 from `secrets/{web,admin}.env` on the Mac (`wrangler secret bulk`, gitignored via .git/info/exclude): Supabase secret key, Stripe key + webhook (now live, see above), booking email, generated THROTTLE_SALT/REVALIDATE_SECRET/CRON_SECRET. BREVO_API_KEY (`tannin-cloudflare`, API key) loaded on both Workers 2026-11-25; Brevo IP blocking turned off (needed for Cloudflare); a test send via the API worked. Vercel still sends via SMTP.
- Tested on Free: a real Stripe test purchase (voucher 10007, 150 EUR, 2026-11-25) was activated by the new webhook, so payment + confirmation work. **The voucher PDF download fails on Free**: 5 of 12 parallel downloads hit `exceededCpu` (503) on fresh isolates; warm ones work (about 0.5 s). Sacha's own download failed this way. Fixed by Workers Paid (bought 2026-11-25 on Sacha's card, monthly; swap to the owner's card in Billing > Payment info): 24 of 24 parallel downloads OK. Stripe webhook rejects unsigned calls (400); admin voucher PDF refuses without login (403). Instagram sync runs but says no Instagram account is connected in the database: that is true on Vercel too (no INSTAGRAM_APP_ID/SECRET anywhere), so it has not been syncing.

## Needs Sacha
0. Try Admin > Texts and Admin > Pages signed in (incl. one Translate click).
1. Later: move the Workers Paid billing to the owner's card.
4. Hero decision (CE-LLAR logo, old branch `cellar-logo` in szaidman55/Tannin; not copied here).
5. Confirm the live Stripe account is in the owner's name with the right bank account (payouts). VAT treatment of vouchers with the accountant. Optional: one small real purchase + refund to prove the live webhook.

## Next steps
0. After PR #1 is live: fill the French texts that are missing (57, incl. the whole gift page, which shows raw keys on /fr/gift today) in Admin > Texts.
1. Decide whether to connect Instagram (needs a Meta app ID/secret).
2. (done) Admin login confirmed on the new database 2026-11-25.
3. Connect this repo to Cloudflare Workers Builds (Git) so pushes deploy; set the weekly backup secret `SUPABASE_DB_URL`.
4. Keep Vercel as the demo; delete the disabled live webhook `tannin-web-vercel-live` when sure. Optional: Google Search Console for ta-nnin.be + submit sitemap.

## Watch out
- The Mac deploy clone `~/Documents/GitHub/tannin-cloudflare` is BEHIND main (no content editor; local uncommitted changes equal what is on main). Deploying from it as it is would remove the editor. The 2026-11-25 deploy was done from a fresh clone of main in /tmp: `source ~/.config/tannin-cf/build-env.sh`, `npm ci --include=dev`, `npm run cf:deploy` in apps/web then apps/admin. Bring that clone up to main before using it again.
- In the old repo `szaidman55/Tannin`, pushing `main` deploys Vercel (the demo, old database). `secrets/web.env`/`admin.env` still hold the OLD Supabase secret key (the copy scripts use it); the live key is `NEW_SUPABASE_SECRET_KEY` in `secrets/supabase.env`. DB copy scripts: `~/.config/tannin-cf/dbtool` on the Mac. This repo deploys nothing yet.
- Commit messages and files carry no co-author trailers, session links or tool names.
- Worktree branches are never pushed as they are: rename or merge first.
- Never write secrets, keys or payment details here.
