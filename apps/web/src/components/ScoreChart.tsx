"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMotionOk } from "./useMotion";

export interface ScoreChartPoint {
  label: string;
  score: number;
}

/** A trader's score over time, as a line that draws in. `compact` is a bare sparkline. */
export default function ScoreChart({ points, color, compact = false }: { points: ScoreChartPoint[]; color: string; compact?: boolean }) {
  const animate = useMotionOk();
  return (
    <div className={`chart ${compact ? "compact" : ""}`} style={compact ? undefined : { height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: compact ? 4 : 12, bottom: 0, left: compact ? 4 : 0 }}>
          {!compact && <CartesianGrid stroke="var(--line)" vertical={false} />}
          {!compact && <XAxis dataKey="label" tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={32} />}
          <YAxis
            domain={compact ? [(min: number) => Math.max(0, Math.floor(min) - 6), (max: number) => Math.min(100, Math.ceil(max) + 6)] : [0, 100]}
            hide={compact}
            ticks={compact ? undefined : [0, 25, 50, 75, 100]}
            tick={{ fill: "var(--ink-3)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={34}
          />
          {!compact && (
            <Tooltip
              cursor={{ stroke: "var(--line-strong)" }}
              contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
              labelStyle={{ color: "var(--ink-3)" }}
              formatter={(v: number) => [v, "Score"]}
            />
          )}
          <Line
            type="monotone"
            dataKey="score"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            dot={compact ? false : { r: 3.5, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: color, strokeWidth: 0 }}
            isAnimationActive={animate}
            animationDuration={1100}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
