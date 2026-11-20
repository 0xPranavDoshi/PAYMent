"use client";

import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/api";
import { podiumOrder } from "@/lib/leaderboard";
import { formatCents, formatChange, formatPct } from "@/lib/format";
import { CopyTradeToggle, type CopyState } from "./CopyTicket";

export interface CopyContext {
  copies: Record<string, CopyState>;
  signedIn: boolean;
  viewerId: string | null;
  openHandle: string | null;
  setOpenHandle: (handle: string | null) => void;
}

/** The overall top 3 (#2 left, #1 raised in the middle, #3 right). */
export default function Podium({ top, ctx }: { top: LeaderboardEntry[]; ctx: CopyContext }) {
  const order = podiumOrder(top.map((e, i) => ({ e, rank: i + 1 })));
  return (
    <div className={`lb-podium n${top.length}`}>
      {order.map(({ e, rank }) => {
        const isNew = e.tier === "new";
        const first = rank === 1;
        const change = formatChange(e.change14d);
        return (
          <div key={e.handle} className={`lb-pc${first ? " first" : ""}`}>
            <div className="r1">
              <span className="rk">#{rank}</span>
              <div className="nm">
                <Link href={`/traders/${encodeURIComponent(e.handle)}`}>
                  <b>@{e.handle}</b>
                </Link>
                <small>{e.nResolved} resolved picks</small>
              </div>
            </div>
            <div className="r2">
              <span className={`sc${isNew ? " none" : ""}`}>
                {isNew ? "NEW" : e.score}
                {first && change?.direction === "up" && <span className="chip up big">{change.text}</span>}
              </span>
              {first ? (
                <div className="lb-side">
                  <CopyTradeToggle
                    handle={e.handle}
                    copy={ctx.copies[e.handle.toLowerCase()] ?? null}
                    signedIn={ctx.signedIn}
                    viewerId={ctx.viewerId}
                    nPicks={e.nResolved}
                    primary
                    ticketPlacement="below"
                    open={ctx.openHandle === e.handle}
                    onOpenChange={(o) => ctx.setOpenHandle(o ? e.handle : null)}
                  />
                </div>
              ) : (
                <div className="kv">
                  HIT RATE <b>{formatPct(e.hitRate)}</b>
                  <br />
                  EDGE/PICK <b>{isNew ? "–" : formatCents(e.skill)}</b> · {isNew ? <b>NEW</b> : <>14D <b>{change ? change.text : "—"}</b></>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
