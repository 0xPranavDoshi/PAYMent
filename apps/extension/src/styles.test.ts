import { describe, expect, it } from "vitest";
import { POPOVER_CSS } from "./styles.js";

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
}

describe("POPOVER_CSS", () => {
  it("draws a focus ring on the stepper's buttons, which `all: unset` would otherwise remove", () => {
    expect(rule(POPOVER_CSS, ".stp button:focus-visible")).toMatch(/outline:\s*2px solid var\(--orange\)/);
  });
});
