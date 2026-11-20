"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runPayoutAction } from "@/lib/onchain-actions";

export default function PayoutButton({ disabled, label }: { disabled: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await runPayoutAction();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "The payout failed." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap-run">
      <button type="button" className="btn primary xl" disabled={disabled || busy} aria-busy={busy} onClick={run}>
        {busy ? "Running payout…" : label}
      </button>
      {msg && <p className={`rw-note ${msg.ok ? "win" : "loss"}`}>{msg.text}</p>}
    </div>
  );
}
