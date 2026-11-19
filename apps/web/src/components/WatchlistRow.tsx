"use client";

import Link from "next/link";
import type { WatchItem } from "@/lib/api";

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #1f1f1f",
  fontSize: 14,
};

function pnlColor(v: number | null): string {
  if (v === null) return "#9a9a9a";
  return v > 0 ? "#4caf50" : v < 0 ? "#e05a5a" : "#9a9a9a";
}

function fmtPnl(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} USDC`;
}

export default function WatchlistRow({
  watch,
  onRemove,
  onCopy,
}: {
  watch: WatchItem;
  onRemove: (traderHandle: string) => void;
  onCopy: (traderHandle: string) => void;
}) {
  return (
    <tr>
      <td style={td}>
        <Link
          href={`/traders/${watch.traderHandle}`}
          style={{ color: "#8ab4f8", fontWeight: 600 }}
        >
          @{watch.traderHandle}
        </Link>
      </td>
      <td style={td}>{watch.nPicks}</td>
      <td style={td}>{watch.activePicks}</td>
      <td style={{ ...td, color: pnlColor(watch.paperPnlUsdc), fontWeight: 600 }}>
        {fmtPnl(watch.paperPnlUsdc)}
      </td>
      <td style={{ ...td, display: "flex", gap: 8 }}>
        <button
          onClick={() => onCopy(watch.traderHandle)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "none",
            background: "#8ab4f8",
            color: "#0f0f0f",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Copy trade
        </button>
        <button
          onClick={() => onRemove(watch.traderHandle)}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "transparent",
            color: "#9a9a9a",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
