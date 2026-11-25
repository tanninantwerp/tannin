# The table card QR

Points at **https://ta-nnin.be/drinks** - everything by the glass.

| File | Use |
| --- | --- |
| `drinks-qr.svg` | **Give this to the printer.** Vector, black on white, scales to any size. |
| `drinks-qr-brand.svg` | Same, in the house ink on paper (`#0d1011` on `#f3f0e9`). |
| `drinks-qr.png` | 2048px raster, for anything that will not take an SVG. |
| `drinks-qr-brand.png` | The brand colours, raster. |

Encoded at error-correction level Q, meaning a quarter of the code can be
obscured and it still reads. That is higher than the usual setting, chosen
because this lives on a table in a bar and will meet condensation, a thumb and
the base of a glass.

## Rules for the printer

- **Do not crop the white border.** The quiet zone around the code is part of
  it; a scanner needs that margin to find the edges.
- **Minimum 2 cm square**, 2.5–3 cm is more comfortable at arm's length.
- **Keep it dark-on-light.** Inverting it stops a good number of phones dead.
- **No logo over the middle** unless you re-test every phone in the building.
  The error correction can absorb it in theory; it is not worth the risk on a
  print run.

## Why this URL will not change

It is the one address in the project pinned in place. The Dutch site does not
translate it - `/nl/drinks`, not `/nl/dranken` - precisely so a reprint is never
needed for a language change. Point the code here once and the cards outlive
every redesign behind them.

The codes currently on the tables belong to one2three and encode a token that
resolves on their servers, so they stop working when that subscription ends and
cannot be redirected. This reprint is the one unavoidable cost of leaving.

## Checking a proof

Scan it with an actual phone before the run. It should open the by-the-glass
list directly - no app, no redirect, no cookie banner.
