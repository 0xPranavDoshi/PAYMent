"use client";

import Link from "next/link";
import { useState } from "react";
import type { LeaderboardEntry } from "@/lib/api";
import { formatChange, formatPct } from "@/lib/format";
import ScoreRing from "./ScoreRing";

const TABS = [
  { id: "all", label: "All", test: () => true },
  { id: "hot", label: "Beating the market", test: (e: LeaderboardEntry) => e.tier === "scored" && e.score > 50 },
  { id: "rising", label: "Rising", test: (e: LeaderboardEntry) => (e.change14d ?? 0) >= 2 },
  { id: "new", label: "New", test: (e: LeaderboardEntry) => e.tier === "new" },
] as const;

export default function TraderGrid({ entries }: { entries: LeaderboardEntry[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const active = TABS.find((t) => t.id === tab)!;
  const shown = entries.filter(active.test);
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Filter traders">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">Nobody matches yet.</div>
      ) : (
        <div className="cards">
          {shown.map((e) => {
            const ch = formatChange(e.change14d);
            return (
              <Link key={e.handle} href={`/traders/${encodeURIComponent(e.handle)}`} className="tcard">
                <div className="tc-top">
                  <ScoreRing score={e.tier === "new" ? null : e.score} size={52} />
                  <div className="tc-id">
                    <b>@{e.handle}</b>
                    <span>{e.nResolved} picks settled</span>
                  </div>
                  {ch && <span className={`chip ${ch.direction}`}>{ch.text}</span>}
                </div>
                <div className="tc-foot">
                  <span>Hit rate <b>{formatPct(e.hitRate)}</b></span>
                  <span>{e.tier === "new" ? "New" : e.score > 50 ? "Beats market" : e.score === 50 ? "Even" : "Trails market"}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
