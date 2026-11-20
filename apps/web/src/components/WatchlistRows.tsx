"use client";

import Link from "next/link";
import { useState } from "react";
import { formatSignedPct, formatUsd, shortDate, tone } from "@/lib/format";
import CopyTicket, { CopyTradeToggle } from "./CopyTicket";
import ScoreTile from "./ScoreTile";
import { WatchButton } from "./TradeButtons";

export interface WatchRowData {
  handle: string;
  watchedAt: string;
  scoreNow: number | null;
  scoreAtWatch: number | null;
  scoreDelta: number | null;
  nPicks: number;
  activePicks: number;
  pnlPct: number | null;
  projectedPnlUsdc: number | null;
  copy: { active: boolean; amountUsdc: number; since: string } | null;
}

/** The watchlist rows. One shared open state, so only one copy ticket is open at a time. */
export default function WatchlistRows({ rows, viewerId }: { rows: WatchRowData[]; viewerId: string }) {
  const [openHandle, setOpenHandle] = useState<string | null>(null);
  return (
    <div className="card hm-rows pf-rows pf-copies wl-rows">
      {rows.map((w, i) => {
        const open = openHandle === w.handle;
        const delta = w.scoreDelta;
        return (
          <div key={w.handle} style={{ display: "contents" }}>
            <div className={`r${i === 0 || openHandle === rows[i - 1]!.handle ? " flush" : ""}`}>
              <ScoreTile score={w.scoreNow} size="sm" />
              <Link href={`/traders/${encodeURIComponent(w.handle)}`} className="who">
                <span className="t">@{w.handle}</span>
                <span className="s">
                  Since {shortDate(w.watchedAt)}
                  {w.scoreAtWatch !== null && w.scoreNow !== null && (
                    <> · score {w.scoreAtWatch} → {w.scoreNow}
                      {delta !== null && delta !== 0 && <span className={delta > 0 ? "up" : "down"}> ({delta > 0 ? "+" : "−"}{Math.abs(delta)})</span>}
                    </>
                  )}
                  {" "}· {w.nPicks - w.activePicks} settled, {w.activePicks} open
                </span>
              </Link>
              <div className="pnl">
                <span className="plabel">Projected P&amp;L</span>
                <b className={tone(w.projectedPnlUsdc)}>{w.pnlPct === null ? "–" : formatSignedPct(w.pnlPct)}</b>
                <small>{w.projectedPnlUsdc === null ? (w.nPicks === 0 ? "No picks yet" : "Not priced yet") : formatUsd(w.projectedPnlUsdc)}</small>
              </div>
              <span className="act">
                <CopyTradeToggle
                  handle={w.handle}
                  copy={w.copy}
                  signedIn
                  viewerId={viewerId}
                  nPicks={0}
                  ticketPlacement="below"
                  open={open}
                  onOpenChange={(o) => setOpenHandle(o ? w.handle : null)}
                />
                <WatchButton handle={w.handle} watching signedIn />
              </span>
            </div>
            {open && <CopyTicket handle={w.handle} copy={w.copy} signedIn viewerId={viewerId} nPicks={0} variant="row" onClose={() => setOpenHandle(null)} />}
          </div>
        );
      })}
    </div>
  );
}
