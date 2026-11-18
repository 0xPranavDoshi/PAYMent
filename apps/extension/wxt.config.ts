import { defineConfig } from "wxt";

const apiOrigin = new URL(process.env.WXT_API_URL ?? "http://localhost:8787").origin;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "coPAYMe",
    description: "Track-record scores next to X handles",
    // The background worker fetches the scoring API, so the page never makes cross-origin calls.
    host_permissions: ["https://x.com/*", `${apiOrigin}/*`],
  },
});
