export type Theme = "light" | "dark";

type Rgba = [number, number, number, number];

/** Parses "rgb(21, 32, 43)" and "rgba(0, 0, 0, 0)". Returns null for anything else. */
export function parseColor(value: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(value.trim());
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Whether the page is light or dark, judged by what is actually painted. X has its own theme
 * (Light, Dim, Lights Out) that is independent of the operating system's, so the page background
 * is the truth; the system preference is only a fallback for a page with no readable background.
 */
export function detectTheme(doc: Document = document): Theme {
  const win = doc.defaultView ?? window;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const color = parseColor(win.getComputedStyle(el).backgroundColor);
    if (color && color[3] > 0.5) return luminance(color) < 0.35 ? "dark" : "light";
  }
  return win.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The page's actual background colour (what X paints behind tweets), or null if nothing opaque is painted. */
export function detectSurface(doc: Document = document): string | null {
  const win = doc.defaultView ?? window;
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const value = win.getComputedStyle(el).backgroundColor;
    const color = parseColor(value);
    if (color && color[3] > 0.5) return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  }
  return null;
}

export interface ThemeStore {
  get(): Theme;
  /** The page background colour, so a tweet shown by us can use exactly X's own. Falls back to white or black. */
  surface(): string;
  /** Called with the new theme whenever it changes. Returns an unsubscribe function. */
  subscribe(listener: (theme: Theme) => void): () => void;
  stop(): void;
}

/** Tracks the page theme and tells listeners when the user switches it, without a reload. */
export function createThemeStore(doc: Document = document): ThemeStore {
  const win = doc.defaultView ?? window;
  let current = detectTheme(doc);
  let currentSurface = detectSurface(doc);
  const listeners = new Set<(theme: Theme) => void>();

  // Dim and Lights Out are both "dark" but paint different backgrounds, so a change of either one counts.
  const refresh = () => {
    const next = detectTheme(doc);
    const nextSurface = detectSurface(doc);
    if (next === current && nextSurface === currentSurface) return;
    current = next;
    currentSurface = nextSurface;
    listeners.forEach((listener) => listener(next));
  };

  // X switches theme by changing styles and attributes on <html> and <body>.
  const observer = new MutationObserver(refresh);
  const options = { attributes: true, attributeFilter: ["style", "class", "data-theme"] };
  observer.observe(doc.documentElement, options);
  if (doc.body) observer.observe(doc.body, options);
  const media = win.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", refresh);

  return {
    get: () => current,
    surface: () => currentSurface ?? (current === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)"),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      observer.disconnect();
      media?.removeEventListener?.("change", refresh);
      listeners.clear();
    },
  };
}
