import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { createMemoryStore } from "./store.memory.js";
import { createMockPaymentProvider } from "./payments.js";
import type { OnchainStore, OnchainUser } from "./store.js";

const SERVICE_KEY = "test-service-key";
const CREATOR: OnchainUser = {
  id: randomUUID(),
  xUserId: "x-creator",
  handle: "nfl_insider",
  walletAddress: "0x1111111111111111111111111111111111111111",
  rewardsOptIn: true,
};
const FOLLOWER: OnchainUser = {
  id: randomUUID(),
  xUserId: "x-follower",
  handle: "follower",
  walletAddress: "0x2222222222222222222222222222222222222222",
  rewardsOptIn: false,
};

function makeApp(seed: OnchainUser[]) {
  const store = createMemoryStore(seed);
  const app = createApp({ store, payments: createMockPaymentProvider(), serviceKey: SERVICE_KEY });
  return { app, store };
}

const svc = { "content-type": "application/json", "x-service-key": SERVICE_KEY };
// User-scoped routes are called by the trusted web backend: service key + the user's id.
const asUser = (id: string) => ({
  "content-type": "application/json",
  "x-service-key": SERVICE_KEY,
  "x-user-id": id,
});

describe("rewards/accrue", () => {
  let app: ReturnType<typeof makeApp>["app"];
  let store: OnchainStore;
  beforeEach(() => {
    ({ app, store } = makeApp([{ ...CREATOR }, { ...FOLLOWER }]));
  });

  it("credits an opted-in creator with a linked wallet", async () => {
    const res = await app.request("/v1/rewards/accrue", {
      method: "POST",
      headers: svc,
      body: JSON.stringify({ creatorHandle: "@NFL_Insider", tailId: randomUUID(), mode: "paper", amountUsdc: 1 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.credited).toBe(true);
    expect(body.amountUsdc).toBe(0.02);
    expect(body.txHash).toBeNull(); // accrual is ledger-only; the tx happens at redeem
    expect(body.reason).toBe("tail_reward");
  });

  it("marks live tails as copy_reward", async () => {
    const res = await app.request("/v1/rewards/accrue", {
      method: "POST",
      headers: svc,
      body: JSON.stringify({ creatorHandle: "nfl_insider", tailId: randomUUID(), mode: "live", amountUsdc: 50 }),
    });
    expect((await res.json()).reason).toBe("copy_reward");
  });

  it("does not pay a creator who has not opted in", async () => {
    const res = await app.request("/v1/rewards/accrue", {
      method: "POST",
      headers: svc,
      body: JSON.stringify({ creatorHandle: "follower", tailId: randomUUID(), mode: "paper", amountUsdc: 1 }),
    });
    const body = await res.json();
    expect(body.credited).toBe(false);
    expect(body.reason).toBe("creator_not_opted_in");
  });

  it("is idempotent per tail (no double pay on retry)", async () => {
    const tailId = randomUUID();
    const payload = JSON.stringify({ creatorHandle: "nfl_insider", tailId, mode: "paper", amountUsdc: 1 });
    await app.request("/v1/rewards/accrue", { method: "POST", headers: svc, body: payload });
    const retry = await app.request("/v1/rewards/accrue", { method: "POST", headers: svc, body: payload });
    expect((await retry.json()).reason).toBe("already_rewarded");

    const totals = await store.earningsFor(CREATOR.id);
    expect(totals.totalEarnedUsdc).toBe(0.02); // paid once
  });

  it("rejects without the service key", async () => {
    const res = await app.request("/v1/rewards/accrue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorHandle: "nfl_insider", tailId: randomUUID(), mode: "paper", amountUsdc: 1 }),
    });
    expect(res.status).toBe(401);
  });
});

describe("earnings + redeem", () => {
  it("summs earnings and redeems to the wallet", async () => {
    const { app, store } = makeApp([{ ...CREATOR }]);
    // Two rewards of 0.02 each.
    for (let i = 0; i < 2; i++) {
      await app.request("/v1/rewards/accrue", {
        method: "POST",
        headers: svc,
        body: JSON.stringify({ creatorHandle: "nfl_insider", tailId: randomUUID(), mode: "paper", amountUsdc: 1 }),
      });
    }

    const earn = await app.request(`/v1/users/${CREATOR.id}/earnings`, { headers: asUser(CREATOR.id) });
    const summary = await earn.json();
    expect(summary.totalEarnedUsdc).toBe(0.04);
    expect(summary.availableUsdc).toBe(0.04);
    expect(summary.rows).toHaveLength(2);

    const redeem = await app.request("/v1/redeem", {
      method: "POST",
      headers: asUser(CREATOR.id),
      body: JSON.stringify({ amountUsdc: 0.03 }),
    });
    expect(redeem.status).toBe(200);
    const r = await redeem.json();
    expect(r.amountUsdc).toBe(0.03);
    expect(r.txHash).toMatch(/^0x/);
    expect(r.availableUsdc).toBe(0.01);

    const after = await (await app.request(`/v1/users/${CREATOR.id}/earnings`, { headers: asUser(CREATOR.id) })).json();
    expect(after.availableUsdc).toBe(0.01);
    expect(after.redeemedUsdc).toBe(0.03);
  });

  it("refuses to redeem more than available", async () => {
    const { app } = makeApp([{ ...CREATOR }]);
    const res = await app.request("/v1/redeem", {
      method: "POST",
      headers: asUser(CREATOR.id),
      body: JSON.stringify({ amountUsdc: 5 }),
    });
    expect(res.status).toBe(409);
  });

  it("requires the service key to read earnings", async () => {
    const { app } = makeApp([{ ...CREATOR }]);
    const res = await app.request(`/v1/users/${CREATOR.id}/earnings`, {
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});

describe("auth + wallet", () => {
  it("upserts an X user, links a wallet, and toggles opt-in", async () => {
    const { app } = makeApp([]);
    const up = await app.request("/v1/auth/x/upsert", {
      method: "POST",
      headers: svc,
      body: JSON.stringify({ xUserId: "x-999", handle: "@NewCreator" }),
    });
    expect(up.status).toBe(201);
    const user = await up.json();
    expect(user.handle).toBe("newcreator");
    expect(user.walletAddress).toBeNull();

    const link = await app.request("/v1/wallet/link", {
      method: "POST",
      headers: asUser(user.userId),
      body: JSON.stringify({ walletAddress: "0x3333333333333333333333333333333333333333" }),
    });
    expect((await link.json()).walletAddress).toBe("0x3333333333333333333333333333333333333333");

    const opt = await app.request("/v1/rewards/opt-in", {
      method: "PATCH",
      headers: asUser(user.userId),
      body: JSON.stringify({ optIn: true }),
    });
    expect((await opt.json()).rewardsOptIn).toBe(true);
  });

  it("rejects an invalid wallet address", async () => {
    const { app } = makeApp([{ ...CREATOR }]);
    const res = await app.request("/v1/wallet/link", {
      method: "POST",
      headers: asUser(CREATOR.id),
      body: JSON.stringify({ walletAddress: "not-an-address" }),
    });
    expect(res.status).toBe(400);
  });
});
