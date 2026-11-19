/** Points as cents per $1 contract, with a real minus sign: 0.38 is "+38¢". */
export function formatCents(points: number): string {
  const cents = Math.round(points * 100);
  if (cents === 0) return "0¢";
  return `${cents > 0 ? "+" : "−"}${Math.abs(cents)}¢`;
}

export function formatPct(fraction: number | null): string {
  return fraction === null ? "–" : `${Math.round(fraction * 100)}%`;
}

const HUE_STOPS: readonly (readonly [number, number])[] = [
  [0, 4],
  [35, 30],
  [55, 48],
  [75, 120],
  [100, 145],
];

/** Ring hue for a score (red, orange, yellow, green), the same scale the extension uses. */
export function scoreHue(score: number): number {
  const s = Math.min(Math.max(score, 0), 100);
  for (let i = 1; i < HUE_STOPS.length; i++) {
    const [s1, h1] = HUE_STOPS[i]!;
    const [s0, h0] = HUE_STOPS[i - 1]!;
    if (s <= s1) return h0 + ((h1 - h0) * (s - s0)) / (s1 - s0);
  }
  return HUE_STOPS[HUE_STOPS.length - 1]![1];
}

/** "+8" / "−3", or null when there is no change worth showing (under 2 points, or none). */
export function formatChange(change: number | null): { text: string; direction: "up" | "down" } | null {
  if (change === null || Math.abs(change) < 2) return null;
  return { text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}`, direction: change > 0 ? "up" : "down" };
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** Dollars, signed, with a real minus sign: "+$0.42", "−$1.10", "$0.00". */
export function formatUsd(dollars: number, signed = true): string {
  const cents = Math.round(dollars * 100);
  if (cents === 0) return "$0.00";
  const body = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  return signed ? `${cents > 0 ? "+" : "−"}${body}` : cents < 0 ? `−${body}` : body;
}

/** A signed percentage to one decimal: "+6.0%", "−12.5%". */
export function formatSignedPct(pct: number): string {
  const tenths = Math.round(pct * 10);
  if (tenths === 0) return "0.0%";
  return `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}%`;
}

export const tone = (v: number | null): "up" | "down" | "muted" => (v === null || Math.round(v * 100) === 0 ? "muted" : v > 0 ? "up" : "down");

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A tweet's time the way X writes it: "Nov 19" beside the name, "7:03 AM · Nov 19, 2026" under the text. */
export function formatTweetTime(iso: string): { short: string; full: string } {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const year = date.toLocaleDateString("en-US", { year: "numeric" });
  return { short: day, full: `${time} · ${day}, ${year}` };
}
