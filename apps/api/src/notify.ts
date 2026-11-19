/** Sends "this call is ready to trade" to the trading service (POST /v1/calls/notify). */
export function createTradingNotifier(opts: {
  /** Base URL of the trading service, e.g. http://localhost:8788 */
  url: string;
  serviceKey: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): (callId: string) => Promise<void> {
  const { url, serviceKey, timeoutMs = 10_000, fetcher = fetch } = opts;
  return async (callId) => {
    const res = await fetcher(new URL("/v1/calls/notify", url), {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": serviceKey },
      body: JSON.stringify({ callId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`trading service answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  };
}
