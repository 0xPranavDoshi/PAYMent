/** The value as a positive integer, or the default when it is missing or anything else. */
export function positiveIntOr(value: string | undefined, fallback: number): number {
  const s = value?.trim() ?? "";
  if (!/^\d+$/.test(s)) return fallback;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
