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

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 34;
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(span === 0 ? h / 2 : h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline fill="none" stroke="#111" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" points={pts} />
    </svg>
  );
}

/** The overall top 3 (#2 left, #1 raised in the middle, #3 right). */
export default function Podium({ top, history, ctx }: { top: LeaderboardEntry[]; history: number[]; ctx: CopyContext }) {
  const order = podiumOrder(top.map((e, i) => ({ e, rank: i + 1 })));
  return (
    <div className={`lb-podium n${top.length}`}>
      {order.map(({ e, rank }) => {
        const isNew = e.tier === "new";
        const first = rank === 1;
        const change = formatChange(e.change14d);
        const delta = e.change14d !== null && e.change14d > 0 ? Math.round(e.change14d) : 0;
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
                {first && delta > 0 && <span className="chip up big">+{delta}</span>}
              </span>
              {first ? (
                <div className="lb-side">
                  <Sparkline values={history} />
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
                  EDGE <b>{formatCents(e.skill)}</b> · {isNew ? <b>NEW</b> : <>14D <b>{change ? (e.change14d! > 0 ? "+" : "−") + Math.abs(e.change14d!) : "0"}</b></>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
