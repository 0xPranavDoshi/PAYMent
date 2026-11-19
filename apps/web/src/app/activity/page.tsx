"use client";

import { useCallback, useEffect, useState } from "react";
import type { TailResponse } from "@copayme/shared";
import { fetchTails } from "@/lib/api";
import {
  clearFollowerId,
  getFollowerId,
  setFollowerId,
} from "@/lib/auth";
import PnlChart from "@/components/PnlChart";
import TailRow from "@/components/TailRow";

export default function ActivityPage() {
  const [followerId, setId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tails, setTails] = useState<TailResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    setId(getFollowerId());
    setReady(true);
  }, []);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      setTails(await fetchTails(id, "copy"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity.");
    }
  }, []);

  useEffect(() => {
    if (followerId) void load(followerId);
  }, [followerId, load]);

  function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setFollowerId(trimmed);
    setId(trimmed);
  }

  function handleSignOut() {
    clearFollowerId();
    setId(null);
    setTails([]);
  }

  if (!ready) return null;

  if (!followerId) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>Activity</h1>
        <form onSubmit={handleSignIn} style={{ marginTop: 16 }}>
          <label style={{ display: "block", marginBottom: 8, color: "#9a9a9a" }}>
            Enter your follower ID (UUID):
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            style={{
              width: 360,
              maxWidth: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#e8e8e8",
            }}
          />
          <button
            type="submit"
            style={{
              marginLeft: 8,
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#8ab4f8",
              color: "#0f0f0f",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

  const filled = tails.filter((t) => t.status === "filled" || t.status === "settled");
  const livePnl = tails.reduce((sum, t) => sum + (t.pnlUsdc ?? 0), 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Activity</h1>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSignOut}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "transparent",
            color: "#9a9a9a",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>

      {error && <p style={{ color: "#e05a5a" }}>{error}</p>}

      <div style={{ display: "flex", gap: 32, marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "#9a9a9a" }}>Live P&amp;L</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: livePnl > 0 ? "#4caf50" : livePnl < 0 ? "#e05a5a" : "#e8e8e8",
            }}
          >
            {livePnl >= 0 ? "+" : ""}
            {livePnl.toFixed(2)} USDC
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#9a9a9a" }}>Filled trades</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{filled.length}</div>
        </div>
      </div>

      {tails.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <PnlChart trades={tails} />
        </div>
      )}

      {tails.length === 0 && !error ? (
        <p style={{ color: "#9a9a9a" }}>No copy-trades yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>Tail</th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>Status</th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>Entry odds</th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>Amount</th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>PnL</th>
            </tr>
          </thead>
          <tbody>
            {tails.map((t) => (
              <TailRow key={t.tailId} tail={t} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
