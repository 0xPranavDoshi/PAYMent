import Link from "next/link";

const linkStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#bdbdbd",
};

export default function Nav() {
  return (
    <nav
      style={{
        borderBottom: "1px solid #262626",
        background: "#141414",
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          height: 56,
        }}
      >
        <Link href="/leaderboard" style={{ fontWeight: 700, fontSize: 18 }}>
          coPAYMe
        </Link>
        <div style={{ flex: 1 }} />
        <Link href="/leaderboard" style={linkStyle}>
          Leaderboard
        </Link>
        <Link href="/watchlist" style={linkStyle}>
          Watchlist
        </Link>
        <Link href="/activity" style={linkStyle}>
          Activity
        </Link>
      </div>
    </nav>
  );
}
