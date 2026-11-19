"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ScoreChartPoint {
  label: string;
  score: number;
}

/** A trader's score over time. `compact` is a bare sparkline; otherwise it has axes and a tooltip. */
export default function ScoreChart({ points, color, compact = false }: { points: ScoreChartPoint[]; color: string; compact?: boolean }) {
  return (
    <div className={`chart ${compact ? "compact" : ""}`} style={compact ? undefined : { height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: compact ? 2 : 8, bottom: 0, left: compact ? 2 : 0 }}>
          {!compact && <CartesianGrid stroke="var(--line)" vertical={false} />}
          {!compact && <XAxis dataKey="label" tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={32} />}
          <YAxis domain={compact ? [(min: number) => Math.max(0, Math.floor(min) - 6), (max: number) => Math.min(100, Math.ceil(max) + 6)] : [0, 100]} hide={compact} ticks={compact ? undefined : [0, 25, 50, 75, 100]} tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} width={34} />
          {!compact && (
            <Tooltip
              contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
              labelStyle={{ color: "var(--ink-3)" }}
              formatter={(v: number) => [v, "Score"]}
            />
          )}
          <Area type="linear" dataKey="score" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} isAnimationActive={false} dot={compact ? false : { r: 3, fill: color, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
