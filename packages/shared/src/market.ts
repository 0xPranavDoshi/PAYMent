/**
 * The Gemini Predictions page of a market, from its event ticker (what we store as the market's
 * `geminiMarketId`), e.g. NCAAM-2611200300-ETAM-CAL-S. It shows the market's prices and, once decided, its
 * result. Checked against gemini.com on Nov 20 2026: the ticker form opens the event's own page for open and
 * settled markets alike, while a slug form only opens the generic Predictions page.
 */
export function marketUrl(ticker: string): string {
  return `https://www.gemini.com/predictions/${encodeURIComponent(ticker)}`;
}
