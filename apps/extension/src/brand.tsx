/**
 * The coPAYMe mark: a "C" with a bright point in its opening, a coin lit from one side.
 * It is the product's signature, so it appears on every badge.
 */
export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M12.44 4.27A5.8 5.8 0 1 0 12.44 11.73" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12.7" cy="8" r="1.55" fill="currentColor" />
    </svg>
  );
}

const RADIUS = 31;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring that fills to the score (0 to 100), with the number inside; a bare ring and "NEW" without a score. */
export function Gauge({ score, label }: { score: number | null; label: string }) {
  const filled = score === null ? 0 : (CIRCUMFERENCE * Math.min(Math.max(score, 0), 100)) / 100;
  return (
    <div className="gauge">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="track" cx="36" cy="36" r={RADIUS} fill="none" strokeWidth="5" />
        {score !== null && (
          <circle
            className="fill"
            cx="36"
            cy="36"
            r={RADIUS}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          />
        )}
      </svg>
      <div className={`score ${score === null ? "new" : ""}`}>{label}</div>
    </div>
  );
}
