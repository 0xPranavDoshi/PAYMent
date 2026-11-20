export type DesignTokens = Record<
  | "bg" | "card" | "surface" | "ink" | "ink2" | "ink3" | "orange"
  | "win" | "winSoft" | "loss" | "lossSoft" | "amber" | "ticket" | "line" | "shadow",
  string
>;

export const TOKENS: DesignTokens = {
  bg: "#F3F1EA",
  card: "#FBFAF6",
  surface: "#FFFFFF",
  ink: "#111111",
  ink2: "#55524B",
  ink3: "#8B877D",
  orange: "#FF6A1F",
  win: "#14894B",
  winSoft: "#C9EFD6",
  loss: "#E0412D",
  lossSoft: "#FBD5CF",
  amber: "#E8A317",
  ticket: "#F6F2E6",
  line: "#111111",
  shadow: "#111111",
};

export const TOKENS_DARK: DesignTokens = {
  bg: "#000000",
  card: "#161616",
  surface: "#1E1E1E",
  ink: "#F3F1EA",
  ink2: "#B9B4A8",
  ink3: "#8B877D",
  orange: "#FF6A1F",
  win: "#6EE59C",
  winSoft: "rgba(110,229,156,.14)",
  loss: "#FF8A78",
  lossSoft: "rgba(255,138,120,.14)",
  amber: "#E8A317",
  ticket: "#1B1B1B",
  line: "#F3F1EA",
  shadow: "#FF6A1F",
};

/** camelCase key to a CSS custom property name; digits split (ink2 -> --ink-2). */
function cssVar(key: string): string {
  return "--" + key.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
}

export function tokensCss(selector: string, tokens: DesignTokens): string {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${cssVar(k)}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

export type ScoreBand = "win" | "amber" | "loss" | "none";

export function scoreBand(score: number | null): ScoreBand {
  if (score === null) return "none";
  if (score >= 60) return "win";
  if (score >= 40) return "amber";
  return "loss";
}
