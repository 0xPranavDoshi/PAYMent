import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Nav from "@/components/Nav";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "coPAYMe",
  description: "A score for sports predictors, measured against the market.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <Nav />
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <span>coPAYMe</span>
            <span className="muted">Scores are measured against market odds. Copy trades are simulated.</span>
            <Link href="/how-scoring" className="muted">How scoring works</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
