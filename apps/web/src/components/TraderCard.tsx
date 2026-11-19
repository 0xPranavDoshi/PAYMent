import type { UserProfile } from "@copayme/shared";

function scoreColor(score: number): string {
  if (score >= 70) return "#2e7d32";
  if (score >= 40) return "#a66a00";
  return "#7a2e2e";
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#9a9a9a" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default function TraderCard({ profile }: { profile: UserProfile }) {
  return (
    <div
      style={{
        border: "1px solid #262626",
        borderRadius: 12,
        padding: 24,
        background: "#141414",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>@{profile.handle}</h1>
        <span
          style={{
            background: scoreColor(profile.score),
            color: "#fff",
            borderRadius: 999,
            padding: "4px 12px",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          Score {profile.score}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "#9a9a9a",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {profile.tier}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 20,
          marginTop: 24,
        }}
      >
        <Stat label="Resolved picks" value={profile.nResolved} />
        <Stat label="Wins" value={profile.nWins} />
        <Stat label="Hit rate" value={fmtPct(profile.hitRate)} />
        <Stat label="Skill" value={profile.skill.toFixed(3)} />
        <Stat label="Last call" value={fmtDate(profile.lastCallAt)} />
      </div>
    </div>
  );
}
