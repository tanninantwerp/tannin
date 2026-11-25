# Project notes

Read this before changing anything. It holds the decisions and context that are not obvious from the code. Setup steps are in `docs/SETUP.md`, the layout in `README.md`.

## Keeping these notes current

Work on this project happens from more than one computer and more than one account. Whatever is not in this repo is invisible to the next person who picks it up.

- `git pull` before starting.
- Save as you go: after each decision, fix or finished step, add it here (or to the right file in `docs/`) and commit and push straight away. Do not wait for the end; work can stop at any moment.
- Unfinished code goes to a branch and is pushed there.
- If two notes disagree, fix the stale one.

## The client and the site

- Ta-nnin, wine bar at Volkstraat 50, Antwerpen, owner Tawat Hattatammanoon. CE-LLAR, the bottle shop at Volkstraat 45, has the same owner; one site covers both.
- Canonical domain `ta-nnin.be` (replaces a WordPress site). Going live: `ta-nnin.be` on the `tannin-web` Vercel project and `admin.ta-nnin.be` on `tannin-admin`, one domain with an admin subdomain, as for 58 Diamonds (Sacha, 2026-11-10). `tannin.be` 301s to it and the redirect must stay, since most directories link the old name.
- Strongest reputation assets: Google (4.6, about 420 reviews) and the Star Wine List awards, Gault&Millau HIP and Jurgen Lijcops' 150 best wine bars book.
- History: the pitch to Tawat was a page "Ta-nnin - a proposal for the new website" with four phases. On 2026-07-30 (szaidman@gmail.com account) the time estimate under each phase was removed at Sacha's request and the page was saved as one self-contained HTML file (styles inlined, images embedded). The intro line "Four bites. First one takes a few weekends." was left in because it was not marked for removal.

## Stack and deploy

- Turborepo monorepo: `apps/web` (public site), `apps/admin` (staff admin), `packages/core` (React-free domain logic, so native apps can reuse it later), `packages/supabase`, `packages/email`.
- Hosting: Vercel through the GitHub integration (projects `tannin-web` and `tannin-admin`). Pushing to `main` deploys both. There is no Vercel CLI token here; inspect deploys in the Vercel dashboard.
- Database: Supabase project `otkngcakummnuwnqnqvg` (the current dev/demo database; the real launch gets its own Supabase and domain). Keys live in `apps/admin/.env.local` and `apps/web/.env.local`, never in the repo.
- Supabase keys (since 2026-10-21): the legacy `anon` and `service_role` keys are disabled, and the `default` secret key is deleted. Use only the publishable key (`sb_publishable_…`) for `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the secret key `tannin_service_2026_10_21` for `SUPABASE_SERVICE_ROLE_KEY`. Re-enabling the legacy keys is possible but should not be needed.
- Vercel holds the production values. `SUPABASE_SERVICE_ROLE_KEY` in both `tannin-admin` and `tannin-web` is a Secret. `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be Config, because Vercel refuses a `NEXT_PUBLIC_` variable marked Secret. After changing a key, redeploy both projects, since `NEXT_PUBLIC_` values are built in.
- The Supabase integration on Vercel manages the Supabase variables and rewrote them on 2026-10-21, putting the disabled legacy JWT keys back in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` and the new keys in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. Every build failed with "Legacy API keys are disabled" until 2026-10-28. Since then both apps read the keys through `lib/supabase-keys.ts`, which takes whichever of each pair is not a legacy JWT, so the integration rewriting them again does no harm. Do not delete `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_SECRET_KEY` in Vercel. New key variables must also be listed in `globalEnv` in `turbo.json`, or the Vercel build does not see them.
- The Supabase variables are set for Production only, so Preview deployments fail to build.
- Migrations: the service key can write data but cannot run DDL. Apply migrations by pasting them into the Supabase SQL editor (logged in as Sacha). A "destructive operations" prompt fires on `drop policy`; that is expected.
- Earlier there were two live deployments, `main` (original design) and `v2` (redesign). As of 2026-10-08 only `main` exists on GitHub. If a second branch comes back: functional fixes go to both, design changes only where Sacha says, and watch migration numbers colliding between branches.
- If `@tannin/core` fails to resolve, run `npm install` at the root to relink the workspace packages.
- Tests: `npm test` (vitest, includes migration tests on PGlite), `npm run typecheck`, `npm run lint`.

## Decisions

- **Bookings stay on Zenchef.** "Book a table" links out to Zenchef (`VENUE.bookingUrl` in `packages/core/src/brand.ts`). The in-house reservation system code is still in the repo (`/book`) but not linked; the `/demo` showcase pages were left out of this repo (2026-11-25).
- **Admin is English-only**, labels and table names included, even though the public site is Dutch/English.
- **Tannin's own admin hub is lean:** reservation tiles (Today, Reservations, Tables) are hidden; it keeps Opening hours exceptions, Bar, Wine, Food, Events, People.
- **Opening-hours exceptions** (closed days, one-off hours) live in `hours_exceptions` and show on the Visit page.
- **Staff get no email.** Notifications live in the admin (toasts, pending badge). Guest booking mail goes through Brevo SMTP (`packages/email/src/send.ts`); the sender is a Gmail address for now, and authenticating `ta-nnin.be` in Brevo is the planned upgrade.
- **Content lives in the database**, not the repo: menu, wine list, bar list and events are read from Supabase. `packages/core` menu/wine files are only seed/fallback. A content fix means a database write.
- **Wine list:** `available=false` hides a bottle (sold out) without deleting it. A bottle price of 0 shows "on request".
- **Bar list mirrors one2three** (`one2three.app/tannin/menu`, readable in a browser). The by-the-glass sections rotate weekly; sync by diffing one2three against the `drinks` table. "Out of stock" there means `sold_out=true` here.
- **Instagram is curated, not a live feed.** Event images are saved locally under `apps/web/public/events/instagram/` (never hotlink the Instagram CDN; links expire). `scripts/seed-events.mjs` publishes the events and attaches images by slug.
- **Homepage neon sign:** a thin tube tracing the exact logo (`apps/web/make-tube.mjs` generates it). It flickers even with reduced motion on, by Sacha's choice; the flicker is kept under 3 flashes per second, so do not speed it up.
- **Neon colour:** the house sign is the gold/yellow tube (`.neon-logo--yellow`), which replaced the original red on 2026-10-15. Red and turquoise stay available as `neon` tones; `/home2` shows the red and `/home3` the turquoise.
- **Footer credit:** the copyright and "Forged by" + the 18 Forge logo sit side by side in the centre column of the footer, on the same bottom line as EN / NL and the postcode, with no separator rule (2026-10-15). The credit links to https://18forge.com (hover/focus color `--color-18forge`, #f37021). Same credit as the 58 Diamonds and Eighteen Diamonds sites; it replaced "Website designed by 18 Diamonds Inc." (2026-10-15).
- **CE-LLAR logo:** the hero on `/cellar` shows the shop's real logo, `apps/web/public/brand/cellar-logo.png` (white wordmark with red and teal offsets). Source: Sacha's Illustrator file `CE-LLAR Plot.ps` in iCloud Drive (a PDF despite the extension). The PNG is that page with the grey background and the RAL 5018 / RAL 2002 colour labels removed, rendered transparent and cropped to the wordmark (1606×252); the tagline printed under it in the artwork is cut off, because the page shows `SHOP.tagline` as the small red line instead (2026-10-28). It replaced the CSS neon X and text wordmark. `SHOP.tagline` is now "basement bottles × Ta-nnin".
- **CE-LLAR neon cross:** the red neon cross from the shop's ceiling hangs above the logo on `/cellar` (`apps/web/components/NeonCross.tsx`), outline only (the bulbs inside the real one are left out). It sits on a diagonal, with the short head pointing up-right at 55 degrees clockwise from straight up and the long foot down-left at 235 degrees, and the foot is twice the head; tube width and arms are measured off Sacha's photo. On desktop the text column is centred vertically against the cross and logo together. It shares the homepage sign's glow, strike and flicker through `.neon-logo, .neon-cross` in `globals.css`, including the Reduce Motion exception, so it flickers on iPhones with Reduce Motion on (2026-10-28).
- **No photo of Tawat on the site** (Sacha, 2026-10-28): the black-and-white portrait (`photo-8.jpg`) was removed from the About page and the repo.
- **Permissions:** a `marketing` permission gates the Events editor; grant it on the People screen. A `vouchers` permission gates the Vouchers tile (2026-10-28).
- **Gift vouchers (2026-10-28):** sold online through Stripe Checkout on `/gift`, redeemed in the admin. Defaults chosen without Tawat's answer yet, all easy to change: presets 50/100/150/250/500, any whole amount from 20 to 3000 euros (Sacha, 2026-11-07; the 3000 cap is in `packages/core/src/gift.ts` and the database, migration 0054, since Stripe has no per-payment limit to set), valid 12 months (Belgian legal minimum is 1 year), spendable over several visits, good at both Ta-nnin and CE-LLAR, PDF emailed to the buyer only (no scheduled send to the recipient yet). Online vouchers are an A4 portrait page readable on a phone (`packages/voucher/src/online.ts`), built from the logos and wine hero of Tawat's Canva card (layout since 2026-11-09, Sacha's choice: back and front of the card on one page, red wine hero large at the top, the card's two columns under it, black TA-NNIN and CE-LLAR logos small in the bottom corners); paper vouchers sold at the bar print onto the Canva card itself (`packages/voucher/assets/`). The template's media box starts at y=8.25, which is why positions in `pdf.ts` are measured from y=306. Setup steps are in `docs/SETUP.md` section 9.

- **Gift vouchers in the menu (2026-11-01):** a "Gift vouchers" tab sits between Visit and Book a table in both headers (`GiftCta`, `GIFT_LINK` in `nav-links.ts`), filled in the house neon yellow (`--color-neon-yellow`, #fce068, the sign's tube colour) so it stands apart from Book a table's turquoise. The `/cellar` hero has a yellow Gift vouchers button next to Maps and Instagram. Before this, the only way in was the footer link.
- **Gift vouchers live in Stripe test mode (2026-11-01):** the Ta-nnin x Ce-llar Stripe sandbox secret key is in `tannin-web` (`STRIPE_SECRET_KEY`, Production and Preview) and migration 0053 is applied. A EUR 20 test purchase worked end to end (paid, code 10000, PDF offered); voucher 10000 is a test voucher.

- **Gift voucher payment on our own page (2026-11-01, Sacha chose this over Stripe's hosted page):** `/gift` is two steps in one column - the details form, then `GiftPayment` with Stripe's Payment Element styled in the site's palette (light and dark), Work Sans, square corners. The server opens the Checkout Session with `ui_mode: 'elements'` and returns its client secret; the webhook, `fulfil` and the thank-you page are unchanged. Payment methods are limited in code to card (with Apple Pay and Google Pay) and Bancontact via `allowed_payment_method_types`, not in the dashboard. Sessions expire after an hour. Stripe's Link "save my information" box is turned off (`wallets: { link: 'never' }`), so the card box shows only the card or Bancontact fields. Needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_/pk_live_, matching the secret key) in Vercel for Production and Preview; without it the payment step says it did not go through. The order form always shows, even when Stripe is not set up (Sacha, 2026-11-01: the site is not on ta-nnin.be yet, so nobody finds it by accident); the old "online sales open soon" box is gone.

## Open items

- About page: team section (Tawat, Kat, Fred) is waiting for staff photos.
- Staff PINs are digits-only since 2026-08-05; an older account with letters in its password must have its PIN reset on the People screen.
- A real floor plan needs x/y positions per table and measurements of the room.
- Brevo: authenticate the `ta-nnin.be` domain and send from `bookings@ta-nnin.be`.
- Gift vouchers: Tawat has no Stripe account yet (2026-10-28). Needed: account in his name, Sacha invited as Developer, then test keys in Vercel. VAT treatment of vouchers (multi-purpose, VAT on redemption) to confirm with the accountant.
- Never use em dashes anywhere (code, copy, commit messages); use a plain hyphen.
- **Vercel deploys (2026-11-10):** pushes to `main` stopped deploying after 2026-11-01 because Vercel's GitHub app only had access to `szaidman55/test18sitters`. Fixed by adding `szaidman55/Tannin` under GitHub > Settings > Applications > Vercel. If deploys stop again, check that list first.
- **Button colors (Sacha, 2026-11-10; turquoise tried and rejected 2026-11-12, keep yellow):** the gift flow's buttons (Continue to payment, Pay, Download the voucher) are neon yellow with black text, like the Gift vouchers tab in the header. Booking buttons follow the theme (`--text` on `--surface`: black in light mode, cream in dark mode). Never a fixed `--color-ink` button on a page that can turn dark: it disappears in dark mode.

- 2026-11-14: commit history rewritten on every branch to remove assistant traces (co-author lines, session links, the handoff instructions file, account wording); force-pushed, code unchanged. Old history backed up on the Mac in `~/.jarvis/backups/`. Local branches made before this date carry the old commits: reset them to `origin/<branch>` instead of pushing them.
