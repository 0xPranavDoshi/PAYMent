import { scoreBand } from "@copayme/shared";

const STRIP: Record<string, string> = { win: "var(--win)", amber: "var(--amber)", loss: "var(--loss)" };

/** A square tile with the score and a colour strip along the bottom. `null` is a trader still on the New badge. */
export default function ScoreTile({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  const band = scoreBand(score);
  const strip = STRIP[band];
  return (
    <div
      className={`stile ${size}${strip ? "" : " none"}`}
      style={strip ? ({ ["--c" as string]: strip } as React.CSSProperties) : undefined}
      role="img"
      aria-label={score === null ? "No score yet" : `Score ${score} out of 100`}
    >
      <div className="stile-in">
        <b>{score === null ? "NEW" : score}</b>
        {size === "lg" && <small>SCORE</small>}
      </div>
    </div>
  );
}
