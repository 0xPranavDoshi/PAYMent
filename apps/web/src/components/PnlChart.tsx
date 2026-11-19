"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface PnlPoint {
  label: string;
  cumulative: number;
}

/** Cumulative P&L over time. Flat fill, green when ahead and coral when behind. */
export default function PnlChart({ points }: { points: PnlPoint[] }) {
  const last = points.at(-1)?.cumulative ?? 0;
  const color = last >= 0 ? "var(--win)" : "var(--coral)";
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={32} />
          <YAxis tick={{ fill: "var(--ink-3)", fontSize: 12 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v)}`} />
          <Tooltip
            contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" }}
            labelStyle={{ color: "var(--ink-3)" }}
            formatter={(v: number) => [`${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`, "P&L"]}
          />
          <Area type="linear" dataKey="cumulative" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
