import { scoreHue } from "@/lib/format";

/** A ring filled to the score and coloured by it. `null` is a trader still on the New badge. */
export default function ScoreRing({ score, size = 48 }: { score: number | null; size?: number }) {
  const stroke = Math.max(4, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = score === null ? 0 : (c * Math.min(Math.max(score, 0), 100)) / 100;
  return (
    <div
      className={`ring ${size < 64 ? "sm" : ""}`}
      style={{ width: size, height: size, ...(score === null ? {} : { ["--h" as string]: scoreHue(score) }) }}
      role="img"
      aria-label={score === null ? "No score yet" : `Score ${score} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        {score !== null && (
          <circle
            className="fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            style={{ ["--dash" as string]: `${dash}px`, ["--c" as string]: `${c}px` }}
          />
        )}
      </svg>
      <div className="center">
        <span className="val" style={{ fontSize: Math.round(size * (score === null ? 0.22 : 0.34)) }}>
          {score === null ? "NEW" : score}
        </span>
        <span className="cap">SCORE</span>
      </div>
    </div>
  );
}
