"use client";

import Link from "next/link";
import { useState } from "react";
import type { LeaderboardEntry } from "@/lib/api";
import { FILTERS, ticketSlot, type FilterId } from "@/lib/leaderboard";
import { formatCents, formatChange, formatPct, tone } from "@/lib/format";
import CopyTicket, { CopyTradeToggle, type CopyState } from "./CopyTicket";
import Podium from "./Podium";
import ScoreTile from "./ScoreTile";

function initials(handle: string): string {
  const parts = handle.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : handle.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return letters.toUpperCase();
}

export default function LeaderboardTable({
  entries,
  copies,
  signedIn,
  viewerId,
}: {
  entries: LeaderboardEntry[];
  /** The viewer's copies, keyed by lower-cased handle. */
  copies: Record<string, CopyState>;
  signedIn: boolean;
  viewerId: string | null;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [openHandle, setOpenHandle] = useState<string | null>(null);

  if (entries.length === 0) {
    return <div className="lb-tbl"><div className="lb-empty" style={{ borderTop: 0 }}>No traders scored yet.</div></div>;
  }

  const ctx = { copies, signedIn, viewerId, openHandle, setOpenHandle };
  const active = FILTERS.find((f) => f.id === filter)!;
  const rows = entries.map((e, i) => ({ e, rank: i + 1 })).filter(({ e }) => active.test(e));

  const slot = ticketSlot(rows.map((r) => r.e.handle), openHandle);
  const openEntry = openHandle ? entries.find((e) => e.handle === openHandle) : undefined;

  return (
    <>
      <div className="lb-filters" role="group" aria-label="Filter traders">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.id === filter}
            onClick={() => {
              setFilter(f.id);
              setOpenHandle(null);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Podium top={entries.slice(0, 3)} ctx={ctx} />

      {slot === "podium" && openEntry && (
        <CopyTicket
          handle={openEntry.handle}
          copy={copies[openEntry.handle.toLowerCase()] ?? null}
          signedIn={signedIn}
          viewerId={viewerId}
          nPicks={openEntry.nResolved}
          variant="card"
          onClose={() => setOpenHandle(null)}
        />
      )}

      <div className="lb-tbl">
        <div className="lb-tr h" aria-hidden="true">
          <span>#</span>
          <span>Score</span>
          <span>Trader</span>
          <span className="r c-14">14 days</span>
          <span className="r c-picks">Picks</span>
          <span className="r c-hit">Hit rate</span>
          <span className="r c-edge" title="Edge per pick">Edge/pick</span>
          <span className="r">Action</span>
        </div>
        {rows.length === 0 && <div className="lb-empty">No traders match this filter.</div>}
        {rows.map(({ e, rank }, i) => {
          const isNew = e.tier === "new";
          const change = formatChange(e.change14d);
          const copy = copies[e.handle.toLowerCase()] ?? null;
          const open = openHandle === e.handle;
          return (
            <div key={e.handle} style={{ display: "contents" }}>
              <div className={`lb-tr${i === 0 || (i > 0 && openHandle === rows[i - 1]!.e.handle) ? " flush" : ""}`}>
                <span className="rank">{rank}</span>
                <ScoreTile score={isNew ? null : e.score} size="sm" />
                <Link href={`/traders/${encodeURIComponent(e.handle)}`} className="who">
                  <span className="av">{initials(e.handle)}</span>
                  <span>
                    <b>@{e.handle}</b>
                    <small>{e.nResolved} picks</small>
                  </span>
                </Link>
                <span className={`num c-14 ${change ? change.direction : "muted"}`}>{change ? change.text : "–"}</span>
                <span className="num c-picks">{e.nResolved}</span>
                <span className="hit c-hit">
                  <b>{formatPct(e.hitRate)}</b>
                  <span className="hitbar" style={{ ["--v" as string]: `${Math.round((e.hitRate ?? 0) * 100)}%` }} />
                </span>
                <span className={`num c-edge ${isNew ? "muted" : tone(e.skill)}`}>{isNew ? "–" : formatCents(e.skill)}</span>
                <span className="act">
                  <CopyTradeToggle
                    handle={e.handle}
                    copy={copy}
                    signedIn={signedIn}
                    viewerId={viewerId}
                    nPicks={e.nResolved}
                    primary={rank === 1}
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
    </>
  );
}
