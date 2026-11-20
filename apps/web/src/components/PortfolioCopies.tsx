"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUsd, shortDate, tone } from "@/lib/format";
import CopyTicket, { CopyTradeToggle } from "./CopyTicket";
import ScoreTile from "./ScoreTile";

export interface CopyRowData {
  handle: string;
  score: number | null;
  nPicks: number;
  active: boolean;
  amountUsdc: number;
  nTrades: number;
  createdAt: string;
  pnl: number | null;
}

/** The portfolio's "Copy trading" rows. One shared open state, so only one ticket is open at a time. */
export default function PortfolioCopies({ rows, viewerId }: { rows: CopyRowData[]; viewerId: string }) {
  const [openHandle, setOpenHandle] = useState<string | null>(null);
  return (
    <div className="card hm-rows pf-rows pf-copies">
      {rows.map((c, i) => {
        const copy = { active: c.active, amountUsdc: c.amountUsdc, since: c.createdAt };
        const open = openHandle === c.handle;
        return (
          <div key={c.handle} style={{ display: "contents" }}>
            <div className={`r${i === 0 || openHandle === rows[i - 1]!.handle ? " flush" : ""}`}>
              <ScoreTile score={c.score} size="sm" />
              <Link href={`/traders/${encodeURIComponent(c.handle)}`} className="who">
                <span className="t">@{c.handle}</span>
                <span className="s">
                  {c.active ? `${formatUsd(c.amountUsdc, false)} per pick` : "Paused"} · {c.nTrades} trade{c.nTrades === 1 ? "" : "s"} since {shortDate(c.createdAt)}
                </span>
              </Link>
              <div className="pnl">
                <b className={tone(c.pnl)}>{c.pnl === null ? "–" : formatUsd(c.pnl)}</b>
                <small>P&amp;L</small>
              </div>
              <span className="act">
                <CopyTradeToggle
                  handle={c.handle}
                  copy={copy}
                  signedIn
                  viewerId={viewerId}
                  nPicks={c.nPicks}
                  ticketPlacement="below"
                  open={open}
                  onOpenChange={(o) => setOpenHandle(o ? c.handle : null)}
                />
              </span>
            </div>
            {open && <CopyTicket handle={c.handle} copy={copy} signedIn viewerId={viewerId} nPicks={c.nPicks} variant="row" onClose={() => setOpenHandle(null)} />}
          </div>
        );
      })}
    </div>
  );
}
