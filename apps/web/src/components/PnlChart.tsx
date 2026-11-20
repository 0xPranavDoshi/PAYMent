"use client";

import { useId, useMemo, useState } from "react";
import { aggregateByDay, pnlGeometry } from "@/lib/pnlChart";
import { formatSignedPct, formatUsd } from "@/lib/format";

export interface PnlPoint {
  label: string;
  /** Running total after this trade. */
  cumulative: number;
  /** ISO timestamp, used by the 1W/2W/1M windows. */
  at?: string;
  /** Dollars staked on this trade. */
  amount?: number;
}

const RANGES = [
  { id: "1W", days: 7 },
  { id: "2W", days: 14 },
  { id: "1M", days: 30 },
  { id: "All", days: null },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const W = 930; // plot width inside the 1000-wide viewBox; the labels sit in the remaining 70
const H = 208;
const TOP = 44;
const BOTTOM = 40;
const DAY = 86_400_000;

const money = (v: number) => (v < 0 ? "−" : "") + "$" + String(Math.round(Math.abs(v) * 100) / 100);

/** Running P&L as a bold line, green above $0 and red below, with a latest-value tag and a hover readout. */
export default function PnlChart({ points: trades }: { points: PnlPoint[] }) {
  const points = useMemo(() => aggregateByDay(trades), [trades]);
  const [range, setRange] = useState<RangeId>("All");
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");

  const view = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const end = Math.max(0, ...points.map((p) => (p.at ? Date.parse(p.at) : 0)));
    const inWin = days === null || !end ? points : points.filter((p) => !p.at || Date.parse(p.at) >= end - days * DAY);
    const first = points.indexOf(inWin[0]!);
    const base = inWin.length > 0 && first > 0 ? points[first - 1]!.cumulative : 0;
    const shown = inWin.map((p) => ({ ...p, cumulative: Math.round((p.cumulative - base) * 100) / 100 }));
    const total = shown.at(-1)?.cumulative ?? 0;
    const staked = shown.reduce((s, p) => s + (p.amount ?? 0), 0);
    const startMs = inWin[0]?.at ? Date.parse(inWin[0].at) : 0;
    const span = startMs && end ? Math.max(1, Math.round((end - startMs) / DAY) + 1) : null;
    return { shown, total, staked, span };
  }, [points, range]);

  const { shown, total } = view;
  const geo = useMemo(() => pnlGeometry(shown, W, H), [shown]);
  const up = total >= 0;
  const retPct = view.staked > 0 ? (total / view.staked) * 100 : null;
  const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(2);

  const labelIdx = shown.length < 2 ? [0] : [0, Math.round((shown.length - 1) / 3), Math.round(((shown.length - 1) * 2) / 3), shown.length - 1];
  const uniqueIdx = labelIdx.filter((v, i) => labelIdx.indexOf(v) === i);

  function onKey(e: React.KeyboardEvent<SVGRectElement>) {
    if (shown.length < 2) return;
    const cur = hover ?? shown.length;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (step === 0) {
      if (e.key === "Escape") setHover(null);
      return;
    }
    e.preventDefault();
    setHover(Math.min(shown.length - 1, Math.max(0, step === -Infinity ? 0 : step === Infinity ? shown.length - 1 : cur + step)));
  }

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 1000;
    let best = 0;
    for (let i = 1; i < geo.xs.length; i++) if (Math.abs(geo.xs[i]! - x) < Math.abs(geo.xs[best]! - x)) best = i;
    setHover(shown.length > 1 ? best : null);
  }

  const tagText = sign(total);
  const tagW = tagText.length * 10 + 24;
  const last = geo.last;
  const tagBelow = last !== null && total < 0;
  const h = hover !== null && hover < shown.length ? hover : null;
  const hp = h !== null ? shown[h]! : null;
  const hx = h !== null ? geo.xs[h]! : 0;
  const delta = h !== null ? shown[h]!.cumulative - (h > 0 ? shown[h - 1]!.cumulative : 0) : 0;
  const tipFlip = hx > W - 220;
  const hoverY = h !== null && geo.line ? Number(geo.line.split(" ")[h]!.split(",")[1]) : 0;

  return (
    <div className="card pnl-card">
      <div className="pnl-h">
        <div>
          <div className={`pnl-v ${up ? "up" : "down"}`}>{formatUsd(total)}</div>
          <div className="pnl-s">
            {retPct !== null && <span className={`chip ${retPct >= 0 ? "up" : "down"}`}>{formatSignedPct(retPct)}</span>}
            <span>
              {view.staked > 0 ? `on ${formatUsd(view.staked, false)} copied` : "no trades in this window"}
              {view.span ? ` · last ${view.span} day${view.span === 1 ? "" : "s"}` : ""}
            </span>
          </div>
        </div>
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" aria-pressed={r.id === range} onClick={() => { setRange(r.id); setHover(null); }}>
              {r.id}
            </button>
          ))}
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {hp ? `${hp.label}: ${sign(delta)} that day, total ${sign(hp.cumulative)}` : ""}
      </div>
      <svg viewBox={`0 0 1000 ${TOP + H + BOTTOM}`} width="100%" role="group" aria-label={`Running profit and loss, now ${tagText}`} className="pnl-svg">
        <title>{`Running profit and loss over ${shown.length} day${shown.length === 1 ? "" : "s"}, now ${tagText}`}</title>
        <defs>
          <clipPath id={`${uid}a`}><rect x="0" y="-100" width="1000" height={geo.zeroY + 100} /></clipPath>
          <clipPath id={`${uid}b`}><rect x="0" y={geo.zeroY} width="1000" height={H + 200} /></clipPath>
        </defs>
        <g transform={`translate(0 ${TOP})`}>
          {geo.ticks.map((t) =>
            t.value === 0 ? null : (
              <g key={t.value}>
                <line x1="0" y1={t.y} x2={W} y2={t.y} stroke="#111" strokeOpacity=".14" strokeWidth="1.5" strokeDasharray="5 6" />
                <text x={W + 14} y={t.y + 4} className="pnl-ax">{money(t.value)}</text>
              </g>
            ),
          )}
          <line x1="0" y1={geo.zeroY} x2={W} y2={geo.zeroY} stroke="#111" strokeWidth="2.5" />
          <text x={W + 14} y={geo.zeroY + 4} className="pnl-ax">$0</text>
          {geo.area && (
            <>
              <path d={geo.area} fill="#c9efd6" clipPath={`url(#${uid}a)`} />
              <path d={geo.area} fill="#fbd5cf" clipPath={`url(#${uid}b)`} />
              <path d={geo.line} fill="none" stroke="#111" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}

          {last && h === null && (
            <g>
              <line x1={last.x} y1={tagBelow ? last.y : last.y - 13} x2={last.x} y2={tagBelow ? last.y + 13 : last.y} stroke="#111" strokeWidth="2.5" />
              <g transform={`translate(${last.x - tagW + 8} ${tagBelow ? last.y + 13 : last.y - 43})`}>
                <rect x="3" y="3" width={tagW} height="30" rx="7" fill="#111" />
                <rect width={tagW} height="30" rx="7" fill={up ? "#14894b" : "#e0412d"} stroke="#111" strokeWidth="2.5" />
                <text x={tagW / 2} y="20.5" textAnchor="middle" className="pnl-tag">{tagText}</text>
              </g>
            </g>
          )}

          {uniqueIdx.map((i, k) => (
            <text key={i} x={geo.xs[i]} y={H + 28} textAnchor={k === 0 ? "start" : k === uniqueIdx.length - 1 && uniqueIdx.length > 1 ? "end" : "middle"} className="pnl-ax">
              {(shown[i]?.label ?? "").toUpperCase()}
            </text>
          ))}

          {h !== null && hp && (
            <g pointerEvents="none">
              <line x1={hx} y1="-8" x2={hx} y2={H} stroke="#111" strokeWidth="2" strokeDasharray="4 5" />
              <g transform={`translate(${tipFlip ? hx - 214 : hx + 14} ${Math.min(Math.max(hoverY - 29, -8), H - 66)})`}>
                <rect x="4" y="4" width="200" height="58" rx="8" fill="#111" />
                <rect width="200" height="58" rx="8" fill="#fff" stroke="#111" strokeWidth="2.5" />
                <text x="12" y="20" className="pnl-tip-d">{hp.label.toUpperCase()}</text>
                <text x="12" y="44" className="pnl-tip-v" fill={delta >= 0 ? "#14894b" : "#e0412d"}>{sign(delta)}</text>
                <text x="188" y="44" textAnchor="end" className="pnl-tip-t">total {sign(hp.cumulative)}</text>
              </g>
            </g>
          )}
          <rect x="0" y={-TOP} width={W + 1} height={H + TOP + BOTTOM} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }} tabIndex={0} role="group" aria-label="Chart readout. Use the left and right arrow keys to step through days." onKeyDown={onKey} onBlur={() => setHover(null)} className="pnl-hit" />
        </g>
      </svg>
    </div>
  );
}
