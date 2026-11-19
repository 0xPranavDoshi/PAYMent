import type { Badge, BadgesResponse, CallEntry, UserProfile } from "@copayme/shared";

/** Content script to background worker. */
export interface BadgesRequest {
  type: "badges";
  handles: string[];
}

export type BadgesReply =
  | { ok: true; badges: BadgesResponse }
  | { ok: false; error: string };

/** Asks for the popover's data: the profile and the latest picks. */
export interface ProfileRequest {
  type: "profile";
  handle: string;
}

export interface ProfileData {
  /** Null when we have no record of this handle. */
  profile: UserProfile | null;
  calls: CallEntry[];
}

export type ProfileReply = ({ ok: true } & ProfileData) | { ok: false; error: string };

/** Sent when the user opens a handle's profile page: scan its posts so a score can appear. */
export interface ScanRequest {
  type: "scan";
  handle: string;
  /** The newest tweet by the handle shown on its profile (null: none showed); lets the scout skip X. */
  newestTweetId: string | null;
}

export type ScanReply =
  /** `badge`: the handle's fresh badge (null: still no score) when the scan finished. */
  | { ok: true; status: "done"; badge: Badge | null }
  | { ok: true; status: "skipped" | "failed" | "timeout" }
  | { ok: false; error: string };

export type ExtensionRequest = BadgesRequest | ProfileRequest | ScanRequest;
