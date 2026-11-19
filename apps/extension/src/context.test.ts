import { describe, expect, it } from "vitest";
import { isContextInvalidated } from "./context.js";

describe("isContextInvalidated", () => {
  it("recognises Chrome's error for a content script whose extension was reloaded", () => {
    expect(isContextInvalidated(new Error("Extension context invalidated."))).toBe(true);
    expect(isContextInvalidated(new Error("Error: Extension context invalidated"))).toBe(true);
    expect(isContextInvalidated("Extension context invalidated.")).toBe(true);
  });

  it("does not mistake other failures for it", () => {
    expect(isContextInvalidated(new Error("badges request failed: 500"))).toBe(false);
    expect(isContextInvalidated(new Error("Failed to fetch"))).toBe(false);
    expect(isContextInvalidated(undefined)).toBe(false);
    expect(isContextInvalidated(null)).toBe(false);
    expect(isContextInvalidated({ message: "Extension context invalidated" })).toBe(false);
  });
});
