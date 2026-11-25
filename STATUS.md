# Tannin: status

**Updated:** 2026-11-25 17:55 CET (hosting move, cloud session). Earlier facts from the 19 and 24 Nov checks. This file lives on branch `status-handoff`, not `main`: pushing `main` deploys Vercel. Local `main` has no commits origin lacks.

## State
`origin/main` (841d1f3) is the live line. It has the gift voucher work: online voucher layout, presets 50 to 500, typed amounts 20 to 3000, migration 0054 applied to Supabase on 10 Nov. Every issued voucher is a Stripe test purchase (10000 to 10004, none redeemed or voided). The live Stripe account "Ta-nnin x Ce-llar" exists but has no payments. The CE-LLAR hero choice is still open.

## Hosting move (started 2026-11-25)
Moving off Sacha's personal accounts to GitHub account `tanninantwerp`, a new Supabase account and Cloudflare. Vercel, the live database and DNS are still untouched.
- Decision: Cloudflare. Start on Workers Free and add Workers Paid (5 USD/month) when Sacha is with the owner to enter his card. Don't go live on Free if testing shows failures.
- Draft PR #12 (branch `cloudflare`): OpenNext config for both apps, admin crons as Cloudflare cron triggers (`apps/admin/worker.ts`), Brevo HTTP API for email when `BREVO_API_KEY` is set, weekly Supabase backup workflow, runbook in `docs/hosting-cloudflare.md`. Builds, typecheck and 213 tests pass. Safe to merge before the switch because Vercel is unchanged.
- Free-plan risk (10 ms CPU): voucher PDFs (Stripe webhook, gift PDF download, admin voucher PDF) need 45 to 400 ms, Instagram sync is likely heavy, and page renders are borderline.
- Data to copy to the new Supabase: tables, auth users (admin logins), storage files.

## In progress
- Branch `cellar-logo` is pushed to origin (4 commits, not merged). It has the new CE-LLAR logo (1717x360) and a hero without the neon cross. The Mac working copy is on it. Merging it as it is would delete the gift voucher package and migrations 0053 and 0054. Do not merge it directly.
- Untracked on the Mac: `.cloudflare/` and `docs/cellar-instagram/`. Not committed.
- Local `main` matches `origin/main`. The old local `main` is kept on `backup/main-before-reset-2026-11-16`.

## Needs Sacha
0. Hosting move: transfer the repo to `tanninantwerp` (Settings > Transfer) and install the Claude GitHub app there. Then the Supabase EU project, Cloudflare Workers from Git, and nameservers for ta-nnin.be at the registrar.
1. Hero decision: keep the live CE-LLAR hero with the neon cross (then `cellar-logo` can be dropped), or move the new logo onto `origin/main`.
2. Tawat's Stripe account (in his name, Sacha as Developer), then live keys in Vercel.
3. Confirm the VAT treatment of vouchers with the accountant.

## Next steps
0. Hosting move: after the repo transfer, deploy both Workers to workers.dev on Free, test the risky routes, copy data to the new Supabase, then DNS. Checklist in `docs/hosting-cloudflare.md` (PR #12).
1. Wait for the hero decision. No code change before it.
2. Set up Tawat's Stripe account and live keys once Sacha has them.
3. If the hero changes, port only the logo and hero markup onto a fresh branch from `origin/main`, not from `cellar-logo`.

## Watch out
- Pushing `main` deploys `tannin-web` and `tannin-admin` on Vercel. Never push a local `main` that has commits `origin/main` does not have (it holds older voucher code; see `docs/project-notes.md`, "Branches").
- Commit messages and files carry no co-author trailers, session links or tool names.
- Worktree branches are never pushed as they are: rename or merge first.
- Never write secrets, keys or payment details here.
