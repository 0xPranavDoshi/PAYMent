"use client";

import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/api";

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid #333",
  color: "#9a9a9a",
  fontWeight: 600,
  fontSize: 13,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #1f1f1f",
  fontSize: 14,
};

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function fmtChange(v: number | null): React.ReactNode {
  if (v === null) return <span style={{ color: "#6a6a6a" }}>—</span>;
  const color = v > 0 ? "#4caf50" : v < 0 ? "#e05a5a" : "#9a9a9a";
  const sign = v > 0 ? "▲" : v < 0 ? "▼" : "";
  return (
    <span style={{ color }}>
      {sign} {Math.abs(v)}
    </span>
  );
}

export default function LeaderboardTable({
  entries,
}: {
  entries: LeaderboardEntry[];
}) {
  if (entries.length === 0) {
    return <p style={{ color: "#9a9a9a" }}>No traders scored yet.</p>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>#</th>
          <th style={th}>Handle</th>
          <th style={th}>Score</th>
          <th style={th}>14d</th>
          <th style={th}>Picks</th>
          <th style={th}>Hit Rate</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={e.handle}>
            <td style={{ ...td, color: "#6a6a6a" }}>{i + 1}</td>
            <td style={td}>
              <Link
                href={`/traders/${e.handle}`}
                style={{ color: "#8ab4f8", fontWeight: 600 }}
              >
                @{e.handle}
              </Link>
            </td>
            <td style={{ ...td, fontWeight: 700 }}>{e.score}</td>
            <td style={td}>{fmtChange(e.change14d)}</td>
            <td style={td}>{e.nResolved}</td>
            <td style={td}>{fmtPct(e.hitRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
