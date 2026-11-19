export interface ScoreHistoryStore {
  /**
   * The user's score from the latest snapshot at or before `at`: null when they had none that old,
   * undefined when no user has this handle.
   */
  scoreAt(handle: string, at: Date): Promise<{ score: number; computedAt: Date } | null | undefined>;
}
