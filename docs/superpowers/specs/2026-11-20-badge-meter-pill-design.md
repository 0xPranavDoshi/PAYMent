# Extension badge: meter pill

**Status:** proposed, 2026-11-20. A small change to the badge shown next to handles on x.com.

## Why

The current badge (an outlined box with the orange coPAYMe square, the score, the 14-day change and a
2px offset shadow) reads as heavy next to a handle. The user compared four designs and picked the
meter pill.

## Approaches considered

- A · Colour chip: a chip tinted by score band. Quiet, and it keeps the 14-day change.
- B · Ticker tag: "SCORE" label plus number. The most self-explanatory, but wide, and it blends into dark X.
- C · Mini score tile: the smallest, and it matches the popover tile.
- **D · Meter pill (chosen):** a rounded pill with a small bar that fills to the score, like the
  leaderboard's hit-rate bars. The bar says "out of 100" without words.

## Design

- **Shape:** a fully rounded pill, 20px tall, with a 1.5px ink outline, a white background and no
  shadow. It sits 4px after the handle, as now.
- **Scored trader:** a meter (26×6px, 1.5px ink outline, rounded) filled to `score%` in the band
  colour (win from 60, amber 40–59, loss under 40), then the score in Archivo 800 12px with
  tabular numbers.
- **Dropped from the badge:** the orange coPAYMe square, the offset shadow and the 14-day change
  arrow. The popover still shows the change. *(My call, matching the mockup.)*
- **Other states** use the same pill with a dashed outline and mono 10px text in ink-2, with no
  meter: NEW, Scanning plus clock, Scan picks, No picks found. Scan failed · Retry keeps the loss
  outline and loss text. *(My call: the mockup showed only NEW and Scanning.)*
- **Press:** a 1px nudge down instead of the shadow press. Focus keeps the orange outline.
- **Unchanged:** clicking still opens the popover, hover titles and aria labels stay the same, and
  the badge is always light.

## Left to the builder

Exact CSS, keeping the existing badge tests green, and updating any that assert on the mark or the
arrow.
