/** One user's current score, as read from user_scores. */
export interface ScoreRow {
  /** Lowercase handle. */
  handle: string;
  score: number;
  scoreChange14d: number | null;
  skill: number;
  nResolved: number;
  nWins: number;
  hitRate: number | null;
  lastCallAt: Date | null;
  updatedAt: Date;
  latestSnapshot: { inputsHash: string; computedAt: Date } | null;
}

export interface ScoreStore {
  /** Handles must be lowercase. Users with no score row are simply absent from the result. */
  findByHandles(handles: readonly string[]): Promise<ScoreRow[]>;
  /**
   * Top users by score, best first. Only users with at least minResolved resolved picks, so
   * the board never shows a number that the badge itself hides behind "New".
   * Ties break on more resolved picks, then handle.
   */
  leaderboard(limit: number, minResolved: number): Promise<ScoreRow[]>;
}
