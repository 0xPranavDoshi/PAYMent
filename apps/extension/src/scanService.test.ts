import { describe, expect, it, vi } from "vitest";
import { POLL_EVERY_MS, POLL_FOR_MS, RESCAN_AFTER_MS, createScanService } from "./scanService.js";

const scored = { score: 72, change14d: null, tier: "scored" as const, nResolved: 12, hitRate: 0.58 };
const body = (status: "idle" | "running" | "failed") =>
  JSON.stringify({ handle: "alice", status, scannedAt: status === "idle" ? "2026-11-19T00:00:00.000Z" : null, results: [] });

/** A scout stub that answers each request with the next status in the list (the last one repeats). */
function scout(statuses: ("idle" | "running" | "failed")[], httpStatus = 200) {
  let i = 0;
  return vi.fn(async (_url: URL, _init?: RequestInit) => {
    const status = statuses[Math.min(i++, statuses.length - 1)]!;
    return new Response(body(status), { status: httpStatus });
  });
}

function setup(fetcher: ReturnType<typeof scout>) {
  let t = 1_000_000;
  const refreshBadge = vi.fn(async () => scored);
  const service = createScanService({
    scoutUrl: "http://scout.test",
    refreshBadge,
    fetcher: fetcher as unknown as typeof fetch,
    now: () => t,
    sleep: async (ms) => void (t += ms),
  });
  return { service, refreshBadge, advance: (ms: number) => void (t += ms) };
}

describe("createScanService", () => {
  it("starts a scan, polls until it finishes, then returns the fresh badge", async () => {
    const fetcher = scout(["running", "running", "idle"]);
    const { service, refreshBadge } = setup(fetcher);
    expect(await service.scan("alice")).toEqual({ status: "done", badge: scored });
    const [first, ...polls] = fetcher.mock.calls;
    expect(String(first![0])).toBe("http://scout.test/v1/scout/alice");
    expect(first![1]).toEqual({ method: "POST" });
    expect(polls).toHaveLength(2);
    expect(polls.every(([, init]) => init === undefined)).toBe(true);
    expect(refreshBadge).toHaveBeenCalledWith("alice");
  });

  it("tells the scout the newest tweet seen on the profile when starting a scan", async () => {
    const fetcher = scout(["running", "idle"]);
    const { service } = setup(fetcher);
    await service.scan("alice", "1990000000000000002");
    const [first, poll] = fetcher.mock.calls;
    expect(String(first![0])).toBe("http://scout.test/v1/scout/alice?newest=1990000000000000002");
    expect(String(poll![0])).toBe("http://scout.test/v1/scout/alice");
  });

  it("returns the badge straight away for a handle the scout already scanned (200 from cache)", async () => {
    const fetcher = scout(["idle"]);
    const { service } = setup(fetcher);
    expect(await service.scan("alice")).toEqual({ status: "done", badge: scored });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives up after the poll window and says so", async () => {
    const fetcher = scout(["running"]);
    const { service, refreshBadge } = setup(fetcher);
    expect(await service.scan("alice")).toEqual({ status: "timeout" });
    expect(fetcher.mock.calls.length).toBe(1 + POLL_FOR_MS / POLL_EVERY_MS);
    expect(refreshBadge).not.toHaveBeenCalled();
  });

  it("reports a failed scan and HTTP errors as failed", async () => {
    expect((await setup(scout(["running", "failed"])).service.scan("alice")).status).toBe("failed");
    expect((await setup(scout(["idle"], 429)).service.scan("alice")).status).toBe("failed");
  });

  it("skips a handle it asked about in the last 10 minutes, then asks again", async () => {
    const fetcher = scout(["idle"]);
    const { service, advance } = setup(fetcher);
    await service.scan("alice");
    expect(await service.scan("alice")).toEqual({ status: "skipped" });
    advance(RESCAN_AFTER_MS);
    expect((await service.scan("alice")).status).toBe("done");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares one scan between tabs asking at the same time", async () => {
    const fetcher = scout(["running", "idle"]);
    const { service } = setup(fetcher);
    const [a, b] = await Promise.all([service.scan("alice"), service.scan("alice")]);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(2); // one POST + one poll
  });
});

describe("createScanService: stopping", () => {
  /** A service whose polling pauses call `onSleep`, so a test can press Stop while a scan is being polled. */
  function stoppable(fetcher: ReturnType<typeof scout>, onSleep: (n: number, service: ReturnType<typeof createScanService>) => Promise<void> | void) {
    let t = 1_000_000;
    let n = 0;
    const refreshBadge = vi.fn(async () => scored);
    const service: ReturnType<typeof createScanService> = createScanService({
      scoutUrl: "http://scout.test",
      refreshBadge,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        await onSleep(++n, service);
      },
    });
    return { service, refreshBadge };
  }

  it("stops polling at once, does not fetch the badge, and tells the scout with a DELETE", async () => {
    const fetcher = scout(["running"]);
    const { service, refreshBadge } = stoppable(fetcher, (n, s) => (n === 2 ? void s.cancel("alice") : undefined));
    expect(await service.scan("alice")).toEqual({ status: "stopped" });
    expect(refreshBadge).not.toHaveBeenCalled();
    const deletes = fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0]![0])).toBe("http://scout.test/v1/scout/alice");
    expect(fetcher.mock.calls.length).toBeLessThan(6); // it did not keep polling for the whole window
  });

  it("allows scanning the same handle again right after a stop, instead of skipping for 10 minutes", async () => {
    const fetcher = scout(["running"]);
    const { service } = stoppable(fetcher, (n, s) => (n === 1 ? void s.cancel("alice") : undefined));
    expect(await service.scan("alice")).toEqual({ status: "stopped" });
    const again = scout(["idle"]);
    const { service: second } = setup(again);
    expect((await second.scan("alice")).status).toBe("done"); // a fresh service: baseline
    // and the stopped service itself does not say "skipped":
    expect((await service.scan("alice")).status).not.toBe("skipped");
  });

  it("still stops waiting when the scout cannot be reached for the DELETE", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (_url: URL, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "DELETE") throw new Error("scout down");
      return new Response(body("running"), { status: 200 });
    });
    let t = 1_000_000;
    let n = 0;
    const service: ReturnType<typeof createScanService> = createScanService({
      scoutUrl: "http://scout.test",
      refreshBadge: async () => scored,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        if (++n === 1) await service.cancel("alice");
      },
    });
    expect(await service.scan("alice")).toEqual({ status: "stopped" });
    expect(calls).toContain("DELETE");
  });

  it("cancelling a handle that is not being scanned is harmless", async () => {
    const fetcher = scout(["idle"]);
    const { service } = setup(fetcher);
    await expect(service.cancel("nobody")).resolves.toBeUndefined();
  });
});
