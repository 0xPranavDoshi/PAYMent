import { z } from "zod";

/** Minimum Grok confidence for a post to count as a prediction. */
export const PREDICTION_MIN_CONFIDENCE = 0.7;

export const TeamRef = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
});
export type TeamRef = z.infer<typeof TeamRef>;

export const Prediction = z.object({
  // team_total (one team's points) is extracted so it isn't mistaken for a game total; Gemini doesn't list it.
  betType: z.enum(["win", "spread", "total", "team_total", "player_prop"]),
  league: z.string().nullable(), // "NBA", "NCAAM", "NHL", ... (hint only)
  team: TeamRef,
  opponent: TeamRef.nullable(),
  player: z.string().nullable(), // player_prop only
  metric: z.string().nullable(), // "points", "goals", "assists", ... (props, totals)
  line: z.number().nullable(), // 5.5, 220, 2 ...
  // The line exactly as the post writes it, sign included ("+3.5", "-7", "o17.5", "by 7"). For spreads,
  // code reads the sign from here rather than trusting `claim` ("cover +3.5" is an underdog pick).
  lineAsWritten: z.string().nullable(),
  claim: z.enum(["wins", "loses", "covers", "over", "under"]),
  conviction: z.enum(["strong", "lean"]), // "lock it in" vs "I like them"
  quote: z.string(), // the words in the post that make the claim
});
export type Prediction = z.infer<typeof Prediction>;

export const Sentiment = z.object({
  isPrediction: z.boolean(),
  confidence: z.number().min(0).max(1), // Grok's confidence this is a real prediction
  predictions: z.array(Prediction), // empty when isPrediction is false
  model: z.string(), // model id, for the audit trail
});
export type Sentiment = z.infer<typeof Sentiment>;

/** A post counts as a prediction only when isPrediction is true and confidence >= 0.7. */
export function countsAsPrediction(s: Sentiment | null): boolean {
  return s !== null && s.isPrediction && s.confidence >= PREDICTION_MIN_CONFIDENCE;
}
