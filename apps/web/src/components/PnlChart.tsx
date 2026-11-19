"use client";

import type { TailResponse } from "@copayme/shared";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function PnlChart({ trades }: { trades: TailResponse[] }) {
  let running = 0;
  const data = trades.map((t, i) => {
    running += t.pnlUsdc ?? 0;
    return { index: i + 1, cumulative: Number(running.toFixed(2)) };
  });

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
          <XAxis
            dataKey="index"
            stroke="#9a9a9a"
            tick={{ fontSize: 12 }}
            label={{ value: "Trade", position: "insideBottom", offset: -4, fill: "#9a9a9a", fontSize: 12 }}
          />
          <YAxis
            stroke="#9a9a9a"
            tick={{ fontSize: 12 }}
            label={{ value: "Cumulative USDC", angle: -90, position: "insideLeft", fill: "#9a9a9a", fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{ background: "#141414", border: "1px solid #333", borderRadius: 8 }}
            labelStyle={{ color: "#9a9a9a" }}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke="#8ab4f8"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
