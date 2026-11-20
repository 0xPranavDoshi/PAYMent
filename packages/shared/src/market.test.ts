import { describe, expect, it } from "vitest";
import { marketUrl } from "./market.js";

describe("marketUrl", () => {
  it("links to the market's own Gemini Predictions page by its event ticker", () => {
    expect(marketUrl("NCAAM-2611200300-ETAM-CAL-S")).toBe("https://www.gemini.com/predictions/NCAAM-2611200300-ETAM-CAL-S");
  });

  it("keeps an odd ticker inside the path", () => {
    expect(marketUrl("A/B?x=1#y")).toBe("https://www.gemini.com/predictions/A%2FB%3Fx%3D1%23y");
  });
});
