import type { BadgesResponse } from "@copayme/shared";

/** Content script to background worker. */
export interface BadgesRequest {
  type: "badges";
  handles: string[];
}

export type BadgesReply =
  | { ok: true; badges: BadgesResponse }
  | { ok: false; error: string };
