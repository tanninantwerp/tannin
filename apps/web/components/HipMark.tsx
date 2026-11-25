/**
 * The Gault&Millau HIP mark.
 *
 * Inlined rather than loaded as a file for one reason: the source has no `fill`
 * attributes, so as an `<img>` it renders black on our cream and looks pasted
 * on. Inline, it takes `currentColor` and sits in the page like everything else.
 *
 * The geometry is Gault&Millau's, unmodified - same viewBox, same paths, taken
 * from the badge on their own listing. Colour is the only thing changed, which
 * is what a badge is for. Do not redraw it.
 */
export function HipMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 326.54 260.56"
      role="img"
      aria-label="Gault&Millau HIP"
      fill="currentColor"
      className={className}
    >
      <polygon points="90.09,225.28 120.09,225.28 120.09,39.9 30,39.9 30,0 0,0 0,225.28 30,225.28 30,69.9 90.09,69.9 " />
      <path d="M229.96,39.9h-37.09v220.65h30v-37.42h7.09c25.58,0,49.73-9.53,68-26.84c18.43-17.46,28.58-40.56,28.58-65.05C326.54,80.88,283.22,39.9,229.96,39.9z M277.33,174.52c-12.67,12-29.5,18.62-47.37,18.62h-7.09V69.9h7.09c36.71,0,66.58,27.52,66.58,61.35C296.54,147.42,289.72,162.79,277.33,174.52z" />
      <rect x="140.7" y="39.9" width="30" height="134.85" />
      <ellipse
        transform="matrix(0.9871 -0.1602 0.1602 0.9871 -31.3332 27.6285)"
        cx="155.7"
        cy="208.16"
        rx="17.12"
        ry="17.12"
      />
    </svg>
  );
}
