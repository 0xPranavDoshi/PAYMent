/** Static plot of score = 50 + 50 * tanh(edge / 0.15), edge from -30c to +30c. */
const X0 = 44, X1 = 540, Y0 = 210, Y1 = 20;
const x = (cents: number) => X0 + ((cents + 30) / 60) * (X1 - X0);
const y = (score: number) => Y0 - (score / 100) * (Y0 - Y1);
const score = (cents: number) => 50 + 50 * Math.tanh(cents / 15);

const POINTS = Array.from({ length: 61 }, (_, i) => {
  const c = -30 + i;
  return `${x(c).toFixed(1)},${y(score(c)).toFixed(1)}`;
}).join(" ");

const GRID = [0, 25, 50, 75, 100];
const TICKS = [-30, -15, 0, 15, 30];

function Tag({ fromX, fromY, rx, ry, w, text, fill, color }: { fromX: number; fromY: number; rx: number; ry: number; w: number; text: string; fill: string; color: string }) {
  // the leader runs from the curve to the tag's nearest edge
  const lx = Math.min(Math.max(fromX, rx), rx + w);
  const ly = fromY < ry ? ry : fromY > ry + 30 ? ry + 30 : ry + 15;
  return (
    <g>
      <line x1={fromX} y1={fromY} x2={lx} y2={ly} stroke="#111" strokeWidth={2} />
      <rect x={rx + 3} y={ry + 3} width={w} height={30} rx={7} fill="#111" />
      <rect x={rx} y={ry} width={w} height={30} rx={7} fill={fill} stroke="#111" strokeWidth={2.5} />
      <text x={rx + w / 2} y={ry + 20} textAnchor="middle" fontFamily="var(--mono)" fontSize={13} fontWeight={700} fill={color}>{text}</text>
    </g>
  );
}

export default function ScoreCurve() {
  return (
    <svg width="100%" viewBox="0 0 560 270" style={{ overflow: "visible" }} role="img"
      aria-label="Score against average edge per pick: an edge of minus 15 cents scores 12, no edge scores 50, and an edge of plus 15 cents scores 88.">
      {GRID.map((g) => (
        <g key={g}>
          <line x1={X0} y1={y(g)} x2={X1} y2={y(g)} stroke="#111" strokeOpacity={g === 50 ? 0.9 : 0.13} strokeWidth={g === 50 ? 2 : 1.5} strokeDasharray={g === 50 ? "0" : "5 6"} />
          <text x={34} y={y(g) + 4} textAnchor="end" fontFamily="var(--mono)" fontSize={12} fill="#8b877d">{g}</text>
        </g>
      ))}
      <line x1={x(0)} y1={Y1} x2={x(0)} y2={Y0} stroke="#111" strokeOpacity={0.13} strokeWidth={1.5} strokeDasharray="5 6" />
      <polyline fill="none" stroke="#111" strokeWidth={4} strokeLinejoin="round" points={POINTS} />
      <Tag fromX={x(15)} fromY={y(score(15))} rx={440} ry={64.6} w={140.4} text="+15¢ edge → 88" fill="#c9efd6" color="#14894b" />
      <Tag fromX={x(0)} fromY={y(50)} rx={314} ry={137} w={123.2} text="no edge → 50" fill="#fff" color="#111" />
      <Tag fromX={x(-15)} fromY={y(score(-15))} rx={98} ry={101.4} w={97.4} text="−15¢ → 12" fill="#fbd5cf" color="#e0412d" />
      {TICKS.map((t) => (
        <text key={t} x={x(t)} y={234} textAnchor="middle" fontFamily="var(--mono)" fontSize={12} fill="#8b877d">{t > 0 ? `+${t}¢` : t < 0 ? `−${Math.abs(t)}¢` : "0¢"}</text>
      ))}
      <text x={x(0)} y={254} textAnchor="middle" fontFamily="var(--mono)" fontSize={11.5} fontWeight={700} letterSpacing={0.8} fill="#55524b">AVERAGE EDGE PER PICK (AFTER SHRINKING)</text>
    </svg>
  );
}
