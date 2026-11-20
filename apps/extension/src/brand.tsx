import { scoreBand } from "@copayme/shared";

/** The coPAYMe mark: an outlined orange square. The outline takes the theme's line colour. */
export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="4" style={{ fill: "var(--orange)" }} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * The score as a tile: an outlined square holding the number, with a strip along the bottom in the
 * score's band colour (green from 60, amber from 40, red below). A trader with no score shows NEW.
 */
export function ScoreTile({ score, size }: { score: number | null; size: "sm" | "lg" }) {
  return (
    <div className={`tile ${size}`} role="img" aria-label={score === null ? "No score yet" : `Score ${score} out of 100`}>
      <span className={`score ${score === null ? "new" : ""}`}>{score === null ? "NEW" : score}</span>
      {size === "lg" && <span className="cap">SCORE</span>}
      <i className={`strip ${scoreBand(score)}`} />
    </div>
  );
}
