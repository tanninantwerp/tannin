# Hosting on Cloudflare

Both apps run on Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`).
Worker names are `tannin-web` (ta-nnin.be) and `tannin-admin` (admin.ta-nnin.be).

## Plan
- Start on Workers Free. Its limit is 10 ms CPU per request. Voucher PDFs need 45 to 400 ms,
  and some page renders go over 10 ms, so expect errors on those until Workers Paid
  (5 USD/month, Workers & Pages > Plans) is switched on. Don't go live on Free if testing shows failures.
- No incremental cache is configured yet, so ISR pages (`revalidate = 30`) render on every
  request. Once Paid is on, add the R2 incremental cache from the OpenNext docs if it helps.

## Commands (run in `apps/web` or `apps/admin`)
- `npm run cf:preview`: build and run locally in workerd.
- `npm run cf:deploy`: build and deploy (needs `wrangler login` or CLOUDFLARE_API_TOKEN).
- Workers Builds (Git): root `apps/<app>`, build `npx opennextjs-cloudflare build`,
  deploy `npx opennextjs-cloudflare deploy`.

The build prerenders pages from Supabase, so `NEXT_PUBLIC_SUPABASE_*` must be set as
**build** variables as well as runtime variables.

## Environment
Build and runtime (both apps): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(or `_ANON_KEY`), `NEXT_PUBLIC_SITE_URL`.
Web build: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Admin build: `NEXT_PUBLIC_WEB_URL`.

Runtime secrets (`wrangler secret put` or dashboard > Settings > Variables):
- Both: `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), `BREVO_API_KEY`,
  `BOOKING_FROM_EMAIL`, `REVALIDATE_SECRET`.
- Web: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `THROTTLE_SALT`, `ADMIN_URL`.
- Admin: `CRON_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`.

Email: with `BREVO_API_KEY` set, mail goes through Brevo's HTTP API; the SMTP_* variables
are then not needed.

## Cron
`apps/admin/worker.ts` wraps the OpenNext worker and runs the jobs that were in
`vercel.json`: 06:00 UTC Instagram sync, 07:00 UTC booking reminders. Test locally with
`npx wrangler dev --test-scheduled` then `curl "localhost:8787/__scheduled?cron=0+7+*+*+*"`.

## Database backup
`.github/workflows/db-backup.yml` dumps roles, schema and data every Monday and keeps
them as an artifact for 90 days. Set the repository secret `SUPABASE_DB_URL` (Session pooler
string). Storage files (images) are not in the dump.

Restore into an empty project:
`psql "$DB_URL" -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql`
(`--single-transaction --variable ON_ERROR_STOP=1` recommended).

## Move checklist
1. Repo transferred to the new GitHub account; Claude GitHub app installed there.
2. New Supabase project (EU). Copy roles, schema, data (incl. auth users) and storage files.
3. Cloudflare: create both Workers from Git, set the variables above, deploy to workers.dev, test.
4. Copy every DNS record of ta-nnin.be into Cloudflare (MX and Brevo records included), then switch nameservers at the registrar.
5. Add custom domains to the Workers, move the Stripe webhook to the new URL, update the Instagram app's URLs.
6. Final data copy, go live, keep Vercel paused for a week, then delete it.
