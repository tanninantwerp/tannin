/**
 * The neon cross that hangs on CE-LLAR's ceiling, as an outline only: the red
 * tube, without the bulbs that sit inside it in the room. Laid on a diagonal,
 * the short head pointing up and to the right (55 degrees clockwise from
 * straight up) and the long foot down and to the left (235 degrees), with the
 * foot twice the head.
 *
 * The tube width and the arms are measured off a photo of the real sign (in
 * its own pixels): a tube 300 wide, a head of 535, and arms of 415 either
 * side. The glow, strike and flicker are the homepage sign's, from
 * `.neon-cross` in globals.css.
 */

const BAR = 300;
const HEAD = 535;
const FOOT = 2 * HEAD;
const ARM = 415;
const TILT = (55 * Math.PI) / 180;
// Room round the outline so the stroke is not clipped at the edge.
const PAD = 20;

// The outline upright, centred on the crossing (y grows downward, as in SVG).
const h = BAR / 2;
const upright = [
  [-h, -h - HEAD],
  [h, -h - HEAD],
  [h, -h],
  [h + ARM, -h],
  [h + ARM, h],
  [h, h],
  [h, h + FOOT],
  [-h, h + FOOT],
  [-h, h],
  [-h - ARM, h],
  [-h - ARM, -h],
  [-h, -h],
];

// Turned clockwise by TILT, which swings the head from straight up to up-right.
const cos = Math.cos(TILT);
const sin = Math.sin(TILT);
const turned = upright.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);

const minX = Math.min(...turned.map(([x]) => x)) - PAD;
const minY = Math.min(...turned.map(([, y]) => y)) - PAD;
const maxX = Math.max(...turned.map(([x]) => x)) + PAD;
const maxY = Math.max(...turned.map(([, y]) => y)) + PAD;

const WIDTH = maxX - minX;
const HEIGHT = maxY - minY;

const outline = turned
  .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x - minX).toFixed(1)} ${(y - minY).toFixed(1)}`)
  .join(' ')
  .concat(' Z');

export function NeonCross({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH.toFixed(1)} ${HEIGHT.toFixed(1)}`}
      className={`neon-cross ${className}`}
      style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeLinejoin="round">
        <path d={outline} stroke="var(--neon-tube)" strokeWidth={13} />
        <path d={outline} stroke="var(--neon-core)" strokeWidth={3.5} />
      </g>
    </svg>
  );
}
