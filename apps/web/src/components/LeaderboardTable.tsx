import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/api";
import { formatChange, formatPct } from "@/lib/format";
import ScoreRing from "./ScoreRing";

export default function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) {
    return <div className="board"><div className="empty">No traders scored yet.</div></div>;
  }
  return (
    <div className="board">
      <div className="lrow head" aria-hidden="true">
        <span>#</span>
        <span />
        <span>Trader</span>
        <span className="num hide-sm">14 days</span>
        <span className="num hide-sm">Picks</span>
        <span className="num">Hit rate</span>
      </div>
      {entries.map((e, i) => {
        const change = formatChange(e.change14d);
        return (
          <Link
            key={e.handle}
            href={`/traders/${encodeURIComponent(e.handle)}`}
            className={`lrow${i < 3 ? ` p${i + 1}` : ""}`}
          >
            <span className="rank">{i + 1}</span>
            <ScoreRing score={e.tier === "new" ? null : e.score} size={44} />
            <span className="who">
              @{e.handle}
              <small>{e.tier === "new" ? "New: score after 5 resolved picks" : `${e.nResolved} resolved picks`}</small>
            </span>
            <span className={`num hide-sm ${change ? change.direction : "muted"}`}>{change ? change.text : "–"}</span>
            <span className="num hide-sm">{e.nResolved}</span>
            <span className="num">{formatPct(e.hitRate)}</span>
          </Link>
        );
      })}
    </div>
  );
}
