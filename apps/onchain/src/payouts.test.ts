import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isCreditable, nextUtcDay, planPayout, utcDay, type UnprocessedTail } from "./payouts.js";
import { createApp } from "./app.js";
import { createMemoryStore, type MemoryTail } from "./store.memory.js";
import { createMockPaymentProvider } from "./payments.js";
import type { OnchainUser } from "./store.js";

const RATE = 0.007;
const yesterday = new Date(Date.now() - 36 * 3600 * 1000);
const now = new Date();

const tail = (over: Partial<UnprocessedTail> = {}): UnprocessedTail => ({
  tailId: randomUUID(),
  creatorId: "c1",
  creatorHandle: "creator",
  pnlUsdc: 10,
  settledAt: now,
  creatorOptedInAt: yesterday,
  ...over,
});

describe("planPayout", () => {
  it("charges 0.7% of each winning trade and ignores losers", () => {
    const plan = planPayout([tail({ pnlUsdc: 22.46 }), tail({ pnlUsdc: 14.94 }), tail({ pnlUsdc: -50 })], RATE);
    expect(plan.tails).toBe(2);
    expect(plan.followerProfitUsdc).toBe(37.4);
    expect(plan.feeTotalUsdc).toBeCloseTo(0.2618, 6);
    expect(plan.feeCreditedUsdc).toBeCloseTo(0.2618, 6);
    expect(plan.feeRetainedUsdc).toBe(0);
  });

  it("keeps the fee in the treasury when the creator isn't opted in", () => {
    const plan = planPayout([tail({ creatorOptedInAt: null })], RATE);
    expect(plan.lines[0]!.credited).toBe(false);
    expect(plan.feeRetainedUsdc).toBeCloseTo(0.07, 6);
    expect(plan.feeCreditedUsdc).toBe(0);
  });

  it("splits one creator's trades into credited and retained across an opt-in", () => {
    const optIn = new Date(Date.UTC(2026, 10, 19, 15));
    const plan = planPayout(
      [
        tail({ settledAt: new Date(Date.UTC(2026, 10, 19, 20)), creatorOptedInAt: optIn }), // same day: no
        tail({ settledAt: new Date(Date.UTC(2026, 10, 20, 1)), creatorOptedInAt: optIn }), // next day: yes
      ],
      RATE,
    );
    expect(plan.lines.map((l) => l.credited).sort()).toEqual([false, true]);
  });
});

describe("rewards start the day after opting in", () => {
  it("next UTC day boundary", () => {
    expect(nextUtcDay(new Date("2026-11-19T23:59:00Z")).toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
  it("same-day trades don't count; next-day trades do", () => {
    const optIn = new Date("2026-11-19T10:00:00Z");
    expect(isCreditable(new Date("2026-11-19T23:00:00Z"), optIn)).toBe(false);
    expect(isCreditable(new Date("2026-11-20T00:00:00Z"), optIn)).toBe(true);
    expect(isCreditable(new Date("2026-11-21T09:00:00Z"), null)).toBe(false);
  });
});

describe("payout endpoints", () => {
  const KEY = "k";
  const svc = { "content-type": "application/json", "x-service-key": KEY };
  const creator: OnchainUser = { id: randomUUID(), xUserId: "x1", handle: "creator", walletAddress: "0x1111111111111111111111111111111111111111", rewardsOptIn: true };
  const outsider: OnchainUser = { id: randomUUID(), xUserId: "x2", handle: "outsider", walletAddress: null, rewardsOptIn: false };
  const follower = randomUUID();

  function setup() {
    const tails: MemoryTail[] = [
      { id: randomUUID(), creatorId: creator.id, followerId: follower, pnlUsdc: 22.46, settledAt: now },
      { id: randomUUID(), creatorId: creator.id, followerId: follower, pnlUsdc: -50, settledAt: now },
      { id: randomUUID(), creatorId: outsider.id, followerId: follower, pnlUsdc: 10, settledAt: now },
      { id: randomUUID(), creatorId: creator.id, followerId: creator.id, pnlUsdc: 99, settledAt: now }, // self-tail
    ];
    const store = createMemoryStore([{ ...creator }, { ...outsider }], { tails, optedInAt: { [creator.id]: yesterday } });
    return { app: createApp({ store, payments: createMockPaymentProvider(), serviceKey: KEY }), store };
  }

  it("preview shows the plan and changes nothing", async () => {
    const { app, store } = setup();
    const res = await app.request("/v1/payouts/preview", { method: "POST", headers: svc });
    const body = await res.json();
    expect(body.day).toBe(utcDay());
    expect(body.tails).toBe(2); // winner + outsider winner; loser and self-tail excluded
    expect(body.feeCreditedUsdc).toBeCloseTo(0.15722, 6);
    expect(body.feeRetainedUsdc).toBeCloseTo(0.07, 6);
    expect((await store.earningsFor(creator.id)).availableUsdc).toBe(0);
  });

  it("run credits opted-in creators once, and refuses a second run the same day", async () => {
    const { app, store } = setup();
    const run = await app.request("/v1/payouts/run", { method: "POST", headers: svc, body: JSON.stringify({ runBy: "admin" }) });
    expect(run.status).toBe(201);
    const earnings = await store.earningsFor(creator.id);
    expect(earnings.availableUsdc).toBeCloseTo(0.15722, 6);
    expect(earnings.rows[0]!.reason).toBe("revenue_share");
    expect((await store.earningsFor(outsider.id)).availableUsdc).toBe(0); // treasury kept it

    const again = await app.request("/v1/payouts/run", { method: "POST", headers: svc });
    expect(again.status).toBe(409);
    expect((await store.earningsFor(creator.id)).availableUsdc).toBeCloseTo(0.15722, 6); // not paid twice
    expect(await store.listUnprocessedWinningTails()).toHaveLength(0); // every trade processed
  });

  it("requires the service key", async () => {
    const { app } = setup();
    expect((await app.request("/v1/payouts/run", { method: "POST" })).status).toBe(401);
  });
});
