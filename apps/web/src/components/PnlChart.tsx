"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMotionOk } from "./useMotion";

export interface PnlPoint {
  label: string;
  cumulative: number;
}

/** Cumulative P&L over time, as a line that draws in. Green when ahead and coral when behind. */
export default function PnlChart({ points }: { points: PnlPoint[] }) {
  const animate = useMotionOk();
  const last = points.at(-1)?.cumulative ?? 0;
  const color = last >= 0 ? "var(--win)" : "var(--coral)";
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <ReferenceLine y={0} stroke="var(--line-strong)" />
          <XAxis dataKey="label" tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={32} />
          <YAxis tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v)}`} />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
            labelStyle={{ color: "var(--ink-3)" }}
            formatter={(v: number) => [`${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`, "P&L"]}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            dot={false}
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
