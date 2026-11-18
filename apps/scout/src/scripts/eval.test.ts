import type { PickMatch } from "@copayme/shared";
import { describe, expect, it } from "vitest";
import { type LabelledPost, scoreEval } from "./eval.js";

const post = (o: Partial<LabelledPost> & Pick<LabelledPost, "tweetId">): LabelledPost => ({
  tweetedAt: "2026-11-18T12:00:00.000Z",
  text: "t",
  expected: [],
  ...o,
});

const pick = (o: Partial<PickMatch> = {}): PickMatch => ({
  predictionIndex: 0,
  status: "matched",
  reason: null,
  geminiEventTicker: "NBA-2611190200-LAL-CHA-M",
  gameTicker: "NBA-2611190200-LAL-CHA-M",
  instrumentSymbol: "GEMI-NBA-2611190200-LAL-CHA-M-LAL",
  contractLabel: "Lakers",
  side: "yes",
  gameStartTime: null,
  marketStatus: "open",
  resolutionSide: null,
  ...o,
});

const LAKERS_YES = { instrumentSymbol: "GEMI-NBA-2611190200-LAL-CHA-M-LAL", side: "yes" as const };

describe("scoreEval", () => {
  it("counts an exact symbol and side match as correct", () => {
    const r = scoreEval([post({ tweetId: "t1", expected: [LAKERS_YES] })], new Map([["t1", [pick()]]]));
    expect(r).toEqual({ byBetType: { win: { correct: 1, total: 1 } }, falsePositives: 0, misses: [] });
  });

  it("counts a wrong side as incorrect and reports the tweet as a miss", () => {
    const r = scoreEval(
      [post({ tweetId: "t2", expected: [{ ...LAKERS_YES, side: "no" }] })],
      new Map([["t2", [pick({ side: "yes" })]]]),
    );
    expect(r).toEqual({ byBetType: { win: { correct: 0, total: 1 } }, falsePositives: 0, misses: ["t2"] });
  });

  it("counts matched picks on an expected-empty post as false positives, ignoring non-matched", () => {
    const r = scoreEval(
      [post({ tweetId: "t3", expected: [] })],
      new Map([["t3", [pick(), pick({ status: "no_market" })]]]),
    );
    expect(r).toEqual({ byBetType: {}, falsePositives: 1, misses: [] });
  });

  it("infers bet type from the sub-event ticker suffix: -M win, -S spread, -T total, else prop", () => {
    const cases: [string, string][] = [
      ["NBA-X-LAL-CHA-M", "win"],
      ["NBA-X-LAL-CHA-S", "spread"],
      ["NBA-X-LAL-CHA-T", "total"],
      ["NBA-X-JOKIC-POINTS", "prop"],
    ];
    for (const [ticker, betType] of cases) {
      const sym = `GEMI-${ticker}-LAL`;
      const r = scoreEval(
        [post({ tweetId: "t4", expected: [{ instrumentSymbol: sym, side: "yes" }] })],
        new Map([["t4", [pick({ geminiEventTicker: ticker, instrumentSymbol: sym })]]]),
      );
      expect(r.byBetType).toEqual({ [betType]: { correct: 1, total: 1 } });
    }
  });

  it("falls back to the expected instrument symbol for bet type when nothing matched", () => {
    const r = scoreEval(
      [post({ tweetId: "t5", expected: [LAKERS_YES] })],
      new Map([["t5", [pick({ status: "no_market", instrumentSymbol: null, geminiEventTicker: null })]]]),
    );
    expect(r).toEqual({ byBetType: { win: { correct: 0, total: 1 } }, falsePositives: 0, misses: ["t5"] });
  });
});
