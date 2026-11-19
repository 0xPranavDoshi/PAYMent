import { defineConfig } from "wxt";

const apiOrigin = new URL(process.env.WXT_API_URL ?? "http://localhost:8787").origin;
const scoutOrigin = new URL(process.env.WXT_SCOUT_URL ?? "http://localhost:8789").origin;
const tradingOrigin = new URL(process.env.WXT_TRADING_URL ?? "http://localhost:8788").origin;
// The coPAYMe website — a content script there bridges the signed-in session into the extension.
const webOrigin = new URL(process.env.WXT_WEB_URL ?? "http://localhost:3000").origin;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "coPAYMe",
    description: "Track-record scores next to X handles",
    // chrome.storage.local holds the badge cache.
    permissions: ["storage"],
    // The background worker fetches the scoring API and the scout (which scans a profile when it's
    // opened), so the page never makes cross-origin calls.
    host_permissions: ["https://x.com/*", `${apiOrigin}/*`, `${scoutOrigin}/*`, `${tradingOrigin}/*`, `${webOrigin}/*`],
  },
});
