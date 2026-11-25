# Borrowed marks

## `gault-millau-hip.svg`

The HIP mark, exactly as Gault&Millau serve it on Ta-nnin's own listing:

<https://www.gaultmillau.be/en/hip/ta-nnin-antwerpen>

967 bytes, `viewBox="0 0 326.54 260.56"`, four shapes, no `fill` attributes.
Kept here unmodified as the reference copy. The site renders it from
`apps/web/components/HipMark.tsx`, which is the same geometry inlined so it can
inherit `currentColor` - as a flat `<img>` it draws black on the cream
background and looks stuck on rather than set in.

**Colour is the only thing changed.** Do not redraw, restretch or re-letter it.
A guide's mark is only worth showing because it is theirs.

### Permission

Settled - Sacha confirmed on 5 August 2026 that no further permission is needed.
Ta-nnin is in the guide, and a listed restaurant displaying the guide's mark is
the point of being listed. Nothing here is blocked on Gault&Millau.

Still worth having if it ever turns up: a dated lockup ("HIP 2026") says more
than an undated one, because it dates the recognition rather than leaving a
reader to wonder which year it was. Drop the SVG in beside this one and point
`HipMark.tsx` at the new geometry - the component is only holding the paths, so
that is the whole change. Not a blocker, and not worth chasing.
