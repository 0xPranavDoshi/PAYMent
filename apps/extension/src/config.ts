export const API_URL: string = import.meta.env.WXT_API_URL ?? "http://localhost:8787";
/** The coPAYMe website, for the popover's "Open coPAYMe" link. */
export const WEB_URL: string = import.meta.env.WXT_WEB_URL ?? "http://localhost:3000";
export const MOCK: boolean = import.meta.env.WXT_MOCK === "true";
