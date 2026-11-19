import { useEffect, useState } from "react";

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

const SIZE = 80;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/** Counts from 0 up to `target`, easing out, so the number lands as the ring finishes filling. */
export function useCountUp(target: number | null, durationMs = 1000): number | null {
  const [value, setValue] = useState<number | null>(target === null || prefersReducedMotion() ? target : 0);
  useEffect(() => {
    if (target === null || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

/**
 * A ring that fills to the score (0 to 100) when it appears, with the number counting up inside
 * and the word SCORE under it. A user still on the New badge gets an empty ring and NEW.
 */
export function Gauge({ score }: { score: number | null }) {
  const shown = useCountUp(score);
  const dash = score === null ? 0 : (CIRCUMFERENCE * Math.min(Math.max(score, 0), 100)) / 100;
  return (
    <div className="gauge" role="img" aria-label={score === null ? "No score yet" : `Score ${score} out of 100`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle className="track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} />
        {score !== null && (
          <circle
            className="fill"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
            style={{ "--dash": `${dash}px`, "--c": `${CIRCUMFERENCE}px` } as React.CSSProperties}
          />
        )}
      </svg>
      <div className="center">
        <span className={`score ${score === null ? "new" : ""}`}>{score === null ? "NEW" : shown}</span>
        <span className="cap">SCORE</span>
      </div>
    </div>
  );
}
