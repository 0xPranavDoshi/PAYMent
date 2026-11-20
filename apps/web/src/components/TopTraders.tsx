"use client";

import Link from "next/link";
import { useState } from "react";
import type { LeaderboardEntry } from "@/lib/api";
import { formatChange, formatPct } from "@/lib/format";
import CopyTicket, { CopyTradeToggle, type CopyState } from "./CopyTicket";
import ScoreTile from "./ScoreTile";

/** The homepage's top three. One shared open state, so only one ticket is open at a time. */
export default function TopTraders({
  entries,
  copies,
  signedIn,
  viewerId,
}: {
  entries: LeaderboardEntry[];
  copies: Record<string, CopyState>;
  signedIn: boolean;
  viewerId: string | null;
}) {
  const [openHandle, setOpenHandle] = useState<string | null>(null);
  return (
    <div className="card hm-rows hm-mini">
      {entries.map((e, i) => {
        const copy = copies[e.handle.toLowerCase()] ?? null;
        const change = formatChange(e.change14d);
        const open = openHandle === e.handle;
        return (
          <div key={e.handle} style={{ display: "contents" }}>
            <div className={`r${i === 0 || openHandle === entries[i - 1]!.handle ? " flush" : ""}`}>
              <b>{i + 1}</b>
              <ScoreTile score={e.tier === "new" ? null : e.score} size="sm" />
              <Link href={`/traders/${encodeURIComponent(e.handle)}`} className="who">
                <span className="t">@{e.handle}</span>
                <span className="s">{e.nResolved} picks · {formatPct(e.hitRate)} hit</span>
              </Link>
              <span className={`chg ${change ? change.direction : "muted"}`}>{change ? change.text : e.tier === "new" ? "new" : "–"}</span>
              <span className="act">
                <CopyTradeToggle
                  handle={e.handle}
                  copy={copy}
                  signedIn={signedIn}
                  viewerId={viewerId}
                  nPicks={e.nResolved}
                  primary={i === 0}
                  ticketPlacement="below"
                  open={open}
                  onOpenChange={(o) => setOpenHandle(o ? e.handle : null)}
                />
              </span>
            </div>
            {open && (
              <CopyTicket handle={e.handle} copy={copy} signedIn={signedIn} viewerId={viewerId} nPicks={e.nResolved} variant="row" onClose={() => setOpenHandle(null)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
