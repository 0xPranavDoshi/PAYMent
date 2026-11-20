export interface PnlGeometry {
  line: string;
  area: string;
  zeroY: number;
  ticks: { value: number; y: number }[];
  xs: number[];
  last: { x: number; y: number } | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A 1/2/2.5/5 x 10^k step that gives at most five gridlines once the range snaps outward to it. */
function niceDomain(min: number, max: number): { lo: number; hi: number; step: number } {
  const base = Math.pow(10, Math.floor(Math.log10((max - min) / 5)));
  let out = { lo: min, hi: max, step: max - min };
  for (const m of [1, 2, 2.5, 5, 10, 20, 25, 50, 100]) {
    const step = base * m;
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    out = { lo, hi, step };
    if (Math.round((hi - lo) / step) + 1 <= 5) break;
  }
  return out;
}

/** Pure chart maths: turns a running-total series into SVG paths in a width x height box. */
export function pnlGeometry(points: { cumulative: number }[], width: number, height: number): PnlGeometry {
  const vals = points.map((p) => (Number.isFinite(p.cumulative) ? p.cumulative : 0));
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi === lo) {
    hi = 1;
    lo = -1;
  }
  const pad = (hi - lo) * 0.1;
  const dom = niceDomain(lo - pad, hi + pad);
  lo = dom.lo;
  hi = dom.hi;
  const y = (v: number) => r1(((hi - v) / (hi - lo)) * height);
  const zeroY = y(0);
  const ticks: { value: number; y: number }[] = [];
  for (let i = 0, n = Math.round((hi - lo) / dom.step); i <= n; i++) {
    const value = Math.round((lo + i * dom.step) * 1e6) / 1e6;
    ticks.push({ value: value === 0 ? 0 : value, y: y(value) });
  }

  if (vals.length === 0) return { line: "", area: "", zeroY, ticks, xs: [], last: null };

  const xs = vals.length === 1 ? [width] : vals.map((_, i) => r1((i / (vals.length - 1)) * width));
  const coords = vals.length === 1 ? [{ x: 0, y: y(vals[0]!) }, { x: width, y: y(vals[0]!) }] : vals.map((v, i) => ({ x: xs[i]!, y: y(v) }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const first = coords[0]!;
  const end = coords[coords.length - 1]!;
  const area = `${line} L${end.x},${zeroY} L${first.x},${zeroY} Z`;
  return { line, area, zeroY, ticks, xs, last: { x: end.x, y: end.y } };
}
