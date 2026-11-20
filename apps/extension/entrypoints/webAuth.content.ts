import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

// Bridges the website's sign-in into the extension so X login works as one identity
// across both. The coPAYMe site sets a JS-readable `copayme_uid` cookie when you sign in;
// this copies that user id into chrome.storage.local as `session.userId`, which the
// background worker already reads to trade as the signed-in user (and clears it on sign-out).
export default defineContentScript({
  matches: ["http://localhost:3000/*"],
  runAt: "document_start",
  main() {
    const readUid = (): string | null => {
      const m = document.cookie.match(/(?:^|;\s*)copayme_uid=([^;]+)/);
      const value = m?.[1];
      return value ? decodeURIComponent(value) : null;
    };
    const sync = async () => {
      const uid = readUid();
      if (uid) await browser.storage.local.set({ session: { userId: uid } });
      else await browser.storage.local.remove("session");
    };
    void sync();
    // Re-sync when the tab regains focus, so signing in or out on the site takes effect
    // in the extension without a manual reload.
    window.addEventListener("focus", () => void sync());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void sync();
    });
  },
});
