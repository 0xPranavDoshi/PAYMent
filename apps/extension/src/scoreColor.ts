/**
 * The ring's colour is chosen by the score, on a red, orange, yellow, green scale: low scores are
 * red, the middle is orange and yellow, high scores are green. Only the hue comes from here; the
 * theme supplies saturation and lightness so the colour reads well on both light and dark cards.
 */
const HUE_STOPS: readonly (readonly [score: number, hue: number])[] = [
  [0, 4], // red
  [35, 30], // orange
  [55, 48], // yellow
  [75, 120], // green
  [100, 145], // deep green
];

/** The hue (0 to 360) for a score, blending smoothly between the stops. Scores outside 0 to 100 are clamped. */
export function scoreHue(score: number): number {
  const s = Math.min(Math.max(score, 0), 100);
  for (let i = 1; i < HUE_STOPS.length; i++) {
    const [s1, h1] = HUE_STOPS[i]!;
    const [s0, h0] = HUE_STOPS[i - 1]!;
    if (s <= s1) return h0 + ((h1 - h0) * (s - s0)) / (s1 - s0);
  }
  return HUE_STOPS[HUE_STOPS.length - 1]![1];
}
