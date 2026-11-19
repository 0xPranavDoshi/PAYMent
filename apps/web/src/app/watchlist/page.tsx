"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchWatches,
  removeWatch,
  startCopyTrade,
  type WatchItem,
} from "@/lib/api";
import {
  clearFollowerId,
  getFollowerId,
  setFollowerId,
} from "@/lib/auth";
import WatchlistRow from "@/components/WatchlistRow";

export default function WatchlistPage() {
  const [followerId, setId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    setId(getFollowerId());
    setReady(true);
  }, []);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      setWatches(await fetchWatches(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load watches.");
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
    setWatches([]);
  }

  async function handleRemove(traderHandle: string) {
    if (!followerId) return;
    try {
      await removeWatch(followerId, traderHandle);
      await load(followerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove watch.");
    }
  }

  async function handleCopy(traderHandle: string) {
    if (!followerId) return;
    const entered = window.prompt(`Copy @${traderHandle}: USDC to place on each new pick`, "10");
    if (entered === null) return;
    const amountUsdc = Number(entered);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      setError("Enter a positive USDC amount to copy trade.");
      return;
    }
    setError(null);
    try {
      await startCopyTrade(followerId, traderHandle, amountUsdc);
      await load(followerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start copy trade.");
    }
  }

  if (!ready) return null;

  if (!followerId) {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>Watchlist</h1>
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Watchlist</h1>
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

      {watches.length === 0 && !error ? (
        <p style={{ color: "#9a9a9a" }}>No watched traders yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>
                Trader
              </th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>
                Picks
              </th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}>
                Active
              </th>
              <th
                style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid #333", color: "#9a9a9a", fontSize: 13 }}
                title="What a $1 paper bet on each of their picks would have made"
              >
                Watch PnL
              </th>
              <th style={{ borderBottom: "1px solid #333" }} />
            </tr>
          </thead>
          <tbody>
            {watches.map((w) => (
              <WatchlistRow
                key={w.traderHandle}
                watch={w}
                onRemove={handleRemove}
                onCopy={handleCopy}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
