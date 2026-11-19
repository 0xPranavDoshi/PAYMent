import { ScoutResponse } from "@copayme/shared";

const POLL_MS = 3_000;
const TIMEOUT_MS = 90_000;

const base = (process.env.SCOUT_URL ?? `http://localhost:${process.env.SCOUT_PORT ?? 8789}`).replace(/\/+$/, "");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function parseBody(res: Response): Promise<ScoutResponse | null> {
  const parsed = ScoutResponse.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Trigger one handle's scan, poll until it leaves "running", and return a one-line summary. */
async function prewarm(handle: string): Promise<{ ok: boolean; line: string }> {
  const url = `${base}/v1/scout/${encodeURIComponent(handle)}`;
  const httpError = (status: number) => ({ ok: false, line: `${handle}: HTTP ${status}` });
  try {
    const first = await fetch(url, { method: "POST" });
    if (!first.ok) return httpError(first.status);
    let body = await parseBody(first);
    if (!body) return { ok: false, line: `${handle}: unexpected response` };

    const deadline = Date.now() + TIMEOUT_MS;
    while (body.status === "running") {
      if (Date.now() >= deadline) return { ok: false, line: `${handle}: timed out` };
      await sleep(POLL_MS);
      const res = await fetch(url);
      if (!res.ok) return httpError(res.status);
      body = await parseBody(res);
      if (!body) return { ok: false, line: `${handle}: unexpected response` };
    }
    return {
      ok: body.status === "idle",
      line: `${handle}: ${body.status}, ${body.results.length} results`,
    };
  } catch (e) {
    return { ok: false, line: `${handle}: request failed (${(e as Error).message})` };
  }
}

async function main(): Promise<void> {
  const handles = process.argv.slice(2);
  if (handles.length === 0) {
    console.error("usage: pnpm --filter @copayme/scout prewarm <handle> [handle...]");
    process.exitCode = 1;
    return;
  }
  let anyFailed = false;
  for (const handle of handles) {
    const { ok, line } = await prewarm(handle);
    console.log(line);
    if (!ok) anyFailed = true;
  }
  if (anyFailed) process.exitCode = 1;
}

main();
