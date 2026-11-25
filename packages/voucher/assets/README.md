# Voucher assets

- `gift-voucher-template.pdf` - the printed gift voucher, exactly as Tawat
  exported it from Canva (2 pages, A6 landscape). The website and the admin
  write the name, value, code and date onto its blank lines. To change the
  design, export a new PDF from Canva with the same layout, replace this file
  and run `node scripts/embed-voucher-assets.mjs`. If the lines move, the
  positions in `src/pdf.ts` move with them. The A4 voucher sold online
  (`src/online.ts`) lifts the two logos and the wine hero out of the same
  file, so a new Canva export updates both.
- `WorkSans-Regular.ttf`, `WorkSans-Medium.ttf` - Work Sans, the site's text
  face, so names in any language (accents, Polish, Turkish...) print correctly.
  SIL Open Font License 1.1, see `WorkSans-OFL.txt`.
- `Voces-Regular.ttf` - Voces, the site's display face, for the value and
  the name on the A4 voucher sold online. SIL Open Font License 1.1, see
  `Voces-OFL.txt`.

These files are not read at runtime. `scripts/embed-voucher-assets.mjs` turns
them into `src/assets.generated.ts`, so the PDF works the same on Vercel, in
both apps and in tests without any file-tracing configuration.
