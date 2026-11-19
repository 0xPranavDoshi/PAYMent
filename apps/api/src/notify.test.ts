import { describe, expect, it, vi } from "vitest";
import { createTradingNotifier } from "./notify.js";

describe("createTradingNotifier", () => {
  it("POSTs the call id with the service key", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    await createTradingNotifier({ url: "http://trading:8788", serviceKey: "secret", fetcher })("abc");

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("http://trading:8788/v1/calls/notify");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ callId: "abc" }) });
    expect((init!.headers as Record<string, string>)["x-service-key"]).toBe("secret");
  });

  it("throws with the status when the trading service refuses", async () => {
    const fetcher = vi.fn(async () => new Response("pick window has closed", { status: 409 })) as unknown as typeof fetch;
    await expect(createTradingNotifier({ url: "http://t", serviceKey: "k", fetcher })("abc")).rejects.toThrow(
      /409.*pick window has closed/,
    );
  });
});
