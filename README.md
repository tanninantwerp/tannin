# Ta-nnin

Website for Ta-nnin - urban street wine, Volkstraat 50, Antwerpen.

Built as a monorepo so the iOS and Android apps can be added later without
rewriting the rules. Right now only the website is built; the shared packages
exist so that when the apps arrive, bookings and the menu behave identically on
every surface instead of being implemented three times.

## Layout

```
apps/
  web/                Next.js 15 site - the public website
packages/
  core/               domain layer: menu data, booking rules, brand tokens
  supabase/           typed database client and queries
  email/              transactional email (bookings, gift vouchers)
  voucher/            the gift voucher PDF, written onto the Canva card
supabase/
  migrations/         Postgres schema with row-level security
```

`packages/core` has no React, no DOM and no native imports. That is the whole
point: a React Native app can import it unchanged.

## Running it

Node 20 or newer is required.

```bash
npm install
npm run dev
```

The site is then on http://localhost:3000.

## Brand

Everything is derived from the real artwork rather than approximated:

| Token   | Value     | Where it came from                        |
| ------- | --------- | ----------------------------------------- |
| ink     | `#000105` | the black in the logo - not pure black    |
| green   | `#417e79` | the "urban street wine" lettering         |
| stamp   | `#434b66` | the ink the wooden stamp actually prints  |
| paper   | `#f3f0e9` | the menu card stock                       |

Typefaces are **Voces** for display and **Work Sans** for text - the two faces
already used on ta-nnin.be, loaded through `next/font` so there is no layout
shift and no third-party request at runtime.

Logos in `apps/web/public/brand/` are the originals from the site, with the
white background knocked out to transparency so they sit on any colour.

## The menu

`packages/core/src/menu.ts` is the printed card, transcribed - both of them. The
site opens on whichever one the kitchen is serving: `serviceAt()` switches to
the afterhours card at 21:30 Brussels time, so the page can never advertise a
kitchen that has closed.

## What is wired but not yet switched on

The database schema and the query layer are written and reviewable, but the site
does not talk to Supabase yet - it renders the menu from `packages/core`, which
is faster and better for search. When bookings are wanted:

1. Create a Supabase project, run `supabase/migrations/0001_init.sql`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill it in.
3. Swap the static `MENU` import for `fetchMenu()` from `@tannin/supabase`.

Row-level security is already written so the public key can create a booking but
can never read the guest list back.

## The wine list

`packages/core/src/wines.ts` holds all 167 bottles, decoded from the source PDF
and grouped under the same headings the printed list uses. The site filters it
by colour, country and free text.

It is generated, not hand-written - if a new list arrives, re-run the generator
rather than editing the file.

## Photography

`apps/web/public/brand/` holds the room shots from ta-nnin.be, resized to
1800px and re-compressed.

Worth knowing: the bottle wall is painted almost exactly the logo green
(`#417e79`), so the photographs and the mark already agree. The hero deliberately
darkens only the top and bottom of the frame rather than the whole image, to keep
that colour on screen.

## Where the venue facts come from

The QR code on the printed card points at the bar's Star Wine List page, which
is also the only place the full details are published. Hours, phone, email, the
team and the awards all came from there and now live in
`packages/core/src/brand.ts` and `booking.ts`.

Opening hours are declared once, in `SERVICE_WINDOWS`, and feed both the panel
on the page and the `openingHoursSpecification` in the structured data - so the
hours Google shows cannot drift from the hours on the site.

## Two lists, not one

They are genuinely different products and the site treats them that way:

- `wines.ts` - the **cellar**, 167 bottles, per-bottle prices, from the PDF.
- `drinks.ts` - the **bar list**, everything by the glass plus beer, cocktails,
  the sober and skinny lists, gin, digestives, spirits and soft drinks. Source is
  the one2three menu behind the QR code on the table card.

Only about half the by-the-glass wines exist on the bottle list. The rest are
pours you cannot buy as a bottle, which is rather the point of sitting at the bar.

`drinks.ts` is a **snapshot**, dated in the file.

## Replacing the hosted menu

one2three is being dropped, so `/drinks` exists to take its place: a stable URL,
mobile-first, sticky category nav, search, no images, renders instantly. That is
the page the QR code on the table cards should open.

Two things have to happen before the subscription can actually be cancelled, and
neither is code that exists yet:

1. **The QR codes need re-pointing.** The current ones encode a one2three token,
   so they cannot be redirected - the table cards need reprinting with a code
   for `https://ta-nnin.be/drinks`. Worth generating that QR once and keeping the
   URL fixed forever, so no future change ever needs another reprint.

2. **Tawat needs to be able to edit the list himself.** Right now the drinks live
   in a TypeScript file, which means every price change is a code change and a
   deploy. That is strictly worse than what one2three gave him. The `menu_items`
   table and its row-level security are already written in
   `supabase/migrations/0001_init.sql`; what is missing is the admin screen.

Until (2) is done, the site can show the drinks but must not be the only place
they live.

## Still to confirm

- **Tasting notes.** The source clipped about half of them behind a "read more",
  so those wines carry no note rather than half a sentence. They need pulling
  properly or rewriting.
- The site has not been run yet - Node was not installed on the machine it was
  written on, so the build is unverified.
