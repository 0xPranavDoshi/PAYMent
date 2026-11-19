import type { Badge, BadgesResponse, CallEntry, UserProfile } from "@copayme/shared";
import type { TradingState } from "./trading.js";

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

/** The popover's trading buttons: read or change this user's watch and copy-trade settings for a trader. */
export type TradingRequest =
  | { type: "trading"; op: "state"; handle: string }
  | { type: "trading"; op: "watch"; handle: string; on: boolean }
  | { type: "trading"; op: "copy-start"; handle: string; amountUsdc: number }
  | { type: "trading"; op: "copy-stop"; handle: string };

export type TradingReply = ({ ok: true } & { state?: TradingState }) | { ok: false; error: string };

export type ExtensionRequest = BadgesRequest | ProfileRequest | ScanRequest | TradingRequest;
