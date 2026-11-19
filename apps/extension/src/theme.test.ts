// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThemeStore, detectSurface, detectTheme, luminance, parseColor } from "./theme.js";

describe("parseColor and luminance", () => {
  it("reads rgb and rgba, and rejects other formats", () => {
    expect(parseColor("rgb(21, 32, 43)")).toEqual([21, 32, 43, 1]);
    expect(parseColor("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(parseColor("rgb(255 255 255 / 50%)")).toEqual([255, 255, 255, 0.5]);
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("#fff")).toBeNull();
  });

  it("puts black at 0 and white at 1, with X's three themes on the right sides", () => {
    expect(luminance([0, 0, 0, 1])).toBe(0);
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1);
    expect(luminance([21, 32, 43, 1])).toBeLessThan(0.35); // Dim
    expect(luminance([255, 255, 255, 1])).toBeGreaterThan(0.35); // Light
  });
});

describe("detectTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  it("follows the page background, whatever the operating system prefers", () => {
    for (const [background, expected] of [
      ["rgb(255, 255, 255)", "light"],
      ["rgb(21, 32, 43)", "dark"], // Dim
      ["rgb(0, 0, 0)", "dark"], // Lights Out
    ] as const) {
      document.body.style.backgroundColor = background;
      expect(detectTheme(document)).toBe(expected);
    }
  });

  it("falls back to the <html> background when the body is transparent", () => {
    document.body.style.backgroundColor = "transparent";
    document.documentElement.style.backgroundColor = "rgb(0, 0, 0)";
    expect(detectTheme(document)).toBe("dark");
  });

  it("falls back to the system preference when nothing is painted", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("dark"), addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("matchMedia", matchMedia);
    window.matchMedia = matchMedia as never;
    expect(detectTheme(document)).toBe("dark");
    window.matchMedia = ((q: string) => ({ matches: false, addEventListener() {}, removeEventListener() {}, media: q })) as never;
    expect(detectTheme(document)).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("createThemeStore", () => {
  let store: ReturnType<typeof createThemeStore>;
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
  });
  afterEach(() => store?.stop());

  it("starts from the current theme and tells listeners when the user switches X's theme", async () => {
    store = createThemeStore(document);
    expect(store.get()).toBe("light");
    const seen = vi.fn();
    store.subscribe(seen);

    document.body.style.backgroundColor = "rgb(0, 0, 0)"; // Lights Out
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith("dark"));
    expect(store.get()).toBe("dark");

    // Dim is also "dark", but it paints a different background, so the tweet shown by us must follow it.
    document.body.style.backgroundColor = "rgb(21, 32, 43)";
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(2));
    expect(store.get()).toBe("dark");
    expect(store.surface()).toBe("rgb(21, 32, 43)");

    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    await vi.waitFor(() => expect(seen).toHaveBeenLastCalledWith("light"));
  });

  it("stops telling a listener after it unsubscribes or the store stops", async () => {
    store = createThemeStore(document);
    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    store.subscribe(b);
    offA();
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    await vi.waitFor(() => expect(b).toHaveBeenCalled());
    expect(a).not.toHaveBeenCalled();

    store.stop();
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    await new Promise((r) => setTimeout(r, 20));
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("detectSurface and the store's surface", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  it("returns the exact page background, as X paints it in each theme", () => {
    for (const bg of ["rgb(255, 255, 255)", "rgb(21, 32, 43)", "rgb(0, 0, 0)"]) {
      document.body.style.backgroundColor = bg;
      expect(detectSurface(document)).toBe(bg);
    }
  });

  it("is null when nothing opaque is painted, and the store then falls back to white or black", () => {
    document.body.style.backgroundColor = "transparent";
    expect(detectSurface(document)).toBeNull();
    const store = createThemeStore(document);
    expect(store.surface()).toBe("rgb(255, 255, 255)"); // light fallback
    store.stop();
  });
});
