import { describe, expect, it } from "vitest";
import { rewardAmount } from "./reward.js";

describe("rewardAmount", () => {
  it("is 2% of the stake above the floor", () => {
    expect(rewardAmount(100)).toBe(2);
    expect(rewardAmount(5)).toBe(0.1);
  });

  it("applies the 1-cent floor to tiny stakes", () => {
    expect(rewardAmount(1)).toBe(0.02); // 2% of $1 = 0.02, still above floor
    expect(rewardAmount(0.1)).toBe(0.01); // 2% = 0.002 -> floored to 0.01
  });

  it("rounds to 6 decimal places", () => {
    expect(rewardAmount(3.33333)).toBe(0.066667);
  });
});
