import { describe, expect, it } from "vitest";
import { PickMatch } from "./scout.js";
import { PREDICTION_MIN_CONFIDENCE, Sentiment, countsAsPrediction } from "./sentiment.js";

describe("Sentiment", () => {
  it("accepts a full prediction", () => {
    const s = Sentiment.parse({
      isPrediction: true,
      confidence: 0.9,
      model: "grok-x",
      predictions: [
        {
          betType: "spread",
          league: "NBA",
          team: { name: "Los Angeles Lakers", aliases: ["Lakers", "Los Angeles L", "LAL"] },
          opponent: null,
          player: null,
          metric: null,
          line: 7,
          claim: "covers",
          conviction: "strong",
          quote: "Lakers by 7",
        },
      ],
    });
    expect(s.predictions[0]?.line).toBe(7);
  });

  it("rejects confidence above 1", () => {
    expect(() =>
      Sentiment.parse({ isPrediction: false, confidence: 1.2, predictions: [], model: "m" }),
    ).toThrow();
  });

  it("countsAsPrediction applies the 0.7 threshold", () => {
    expect(PREDICTION_MIN_CONFIDENCE).toBe(0.7);
    const base = { isPrediction: true, predictions: [], model: "m" };
    expect(countsAsPrediction({ ...base, confidence: 0.7 })).toBe(true);
    expect(countsAsPrediction({ ...base, confidence: 0.69 })).toBe(false);
    expect(countsAsPrediction({ ...base, isPrediction: false, confidence: 0.99 })).toBe(false);
    expect(countsAsPrediction(null)).toBe(false);
  });
});

describe("PickMatch", () => {
  it("accepts a no_market result with null fields", () => {
    const m = PickMatch.parse({
      predictionIndex: 0,
      status: "no_market",
      reason: "no game within 7 days",
      geminiEventTicker: null,
      gameTicker: null,
      instrumentSymbol: null,
      contractLabel: null,
      side: null,
      gameStartTime: null,
      marketStatus: null,
      resolutionSide: null,
    });
    expect(m.status).toBe("no_market");
  });
});
