export const API_URL: string = import.meta.env.WXT_API_URL ?? "http://localhost:8787";
/** The coPAYMe website, for the popover's "Open coPAYMe" link. */
export const WEB_URL: string = import.meta.env.WXT_WEB_URL ?? "http://localhost:3000";
/** The trading service (Yash): watches, copy trades, tails. */
export const TRADING_URL: string = import.meta.env.WXT_TRADING_URL ?? "http://localhost:8788";
/** Who to trade as until the X login exists: a user id from the shared database. Empty means signed out. */
export const FOLLOWER_ID: string = import.meta.env.WXT_FOLLOWER_ID ?? "";
export const MOCK: boolean = import.meta.env.WXT_MOCK === "true";
/** The scout service (Grok pipeline), which scans a handle's posts when its profile is opened. */
export const SCOUT_URL: string = import.meta.env.WXT_SCOUT_URL ?? "http://localhost:8789";
