import type { TailResponse } from "@copayme/shared";

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
  return `${sign}${v.toFixed(2)}`;
}

export default function TailRow({ tail }: { tail: TailResponse }) {
  // Realized pnl once settled, otherwise the live mark-to-market (shown with a "live" hint).
  const realized = tail.pnlUsdc !== null && tail.pnlUsdc !== undefined;
  const pnl = realized ? tail.pnlUsdc! : tail.unrealizedPnlUsdc ?? null;
  return (
    <tr>
      <td style={{ ...td, fontFamily: "monospace", color: "#9a9a9a" }}>
        {tail.tailId.slice(0, 8)}
      </td>
      <td style={td}>{tail.status}</td>
      <td style={td}>{(tail.entryOdds * 100).toFixed(0)}%</td>
      <td style={td}>{tail.amountUsdc.toFixed(2)} USDC</td>
      <td style={{ ...td, color: pnlColor(pnl), fontWeight: 600 }}>
        {fmtPnl(pnl)}
        {!realized && pnl !== null && (
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: "#9a9a9a" }}>live</span>
        )}
      </td>
    </tr>
  );
}
