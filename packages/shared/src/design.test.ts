import { describe, expect, it } from "vitest";
import { TOKENS, TOKENS_DARK, tokensCss, scoreBand } from "./design.js";

describe("design tokens", () => {
  it("uses the spec's light values", () => {
    expect(TOKENS).toMatchObject({ bg: "#F3F1EA", ink: "#111111", orange: "#FF6A1F", win: "#14894B", loss: "#E0412D", amber: "#E8A317", ticket: "#F6F2E6", line: "#111111", shadow: "#111111" });
  });
  it("dark variant: cream outlines, orange shadow, brighter win/loss", () => {
    expect(TOKENS_DARK).toMatchObject({ card: "#161616", line: "#F3F1EA", shadow: "#FF6A1F", win: "#6EE59C", loss: "#FF8A78", orange: "#FF6A1F" });
  });
  it("tokensCss emits one custom property per token under the selector", () => {
    const css = tokensCss(":root", TOKENS);
    expect(css.startsWith(":root {")).toBe(true);
    expect(css).toContain("--ink-2: #55524B;");
    expect(css).toContain("--win-soft: #C9EFD6;");
    expect(css).toContain("--shadow: #111111;");
  });
  it.each([[100, "win"], [60, "win"], [59, "amber"], [40, "amber"], [39, "loss"], [0, "loss"], [null, "none"]] as const)(
    "scoreBand(%s) = %s", (score, band) => expect(scoreBand(score)).toBe(band));
});
