"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a server-rendered page current: re-reads its data every so often while the tab is visible, and
 * straight away when you come back to the tab. Without it a page shows what it had when it loaded, so
 * picks a scan just added would only appear after a manual reload. State on the page (an open amount
 * panel, an expanded tweet, the selected tab) is kept, because only the server data is re-read.
 */
export default function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < 3_000) return; // focus and visibility fire together: one refresh is enough
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(refresh, everyMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [router, everyMs]);
  return null;
}
