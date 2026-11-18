import { z } from "zod";

export const GeminiContract = z
  .object({
    instrumentSymbol: z.string(),
    label: z.string(),
    abbreviatedName: z.string().optional(),
    marketState: z.string(),
    strike: z.object({ type: z.string(), value: z.string() }).optional(),
    target: z.object({ name: z.string() }).optional(),
    resolutionSide: z.enum(["yes", "no"]).optional(),
    resolvedAt: z.string().optional(),
  })
  .passthrough();
export type GeminiContract = z.infer<typeof GeminiContract>;

export interface GeminiEvent {
  id: string;
  ticker: string;
  title: string;
  status: string;
  template?: string | undefined;
  startTime?: string | undefined;
  subcategory?: { name: string } | undefined;
  participants?: { name: string; abbreviation: string; side: string }[] | undefined;
  contracts: GeminiContract[];
  events?: GeminiEvent[] | undefined;
  sportsMarket?:
    | { sport?: string | undefined; metric?: string | undefined; scope?: { type?: string | undefined } | undefined }
    | undefined;
  [key: string]: unknown;
}

export const GeminiEvent: z.ZodType<GeminiEvent> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      ticker: z.string(),
      title: z.string(),
      status: z.string(),
      template: z.string().optional(),
      startTime: z.string().optional(),
      subcategory: z.object({ name: z.string() }).passthrough().optional(),
      participants: z
        .array(z.object({ name: z.string(), abbreviation: z.string(), side: z.string() }).passthrough())
        .optional(),
      contracts: z.array(GeminiContract),
      events: z.array(GeminiEvent).optional(),
      sportsMarket: z
        .object({
          sport: z.string().optional(),
          metric: z.string().optional(),
          scope: z.object({ type: z.string().optional() }).passthrough().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
);

export const GeminiEventsResponse = z
  .object({
    data: z.array(GeminiEvent),
    pagination: z.object({ total: z.number() }).passthrough().optional(),
  })
  .passthrough();
