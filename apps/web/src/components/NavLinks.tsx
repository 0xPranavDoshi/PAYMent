"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/how-scoring", label: "How it works", hideSm: true },
];

export default function NavLinks() {
  const path = usePathname();
  return (
    <nav className="links" aria-label="Main">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`) || (l.href === "/leaderboard" && path.startsWith("/traders"));
        return (
          <Link key={l.href} href={l.href} className={`pill ${active ? "active" : ""} ${l.hideSm ? "hide-sm" : ""}`} aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
