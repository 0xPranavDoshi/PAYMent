import type { BadgesResponse, CallEntry, UserProfile } from "@copayme/shared";

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

export type ExtensionRequest = BadgesRequest | ProfileRequest;
