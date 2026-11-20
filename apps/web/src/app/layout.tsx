import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TOKENS, tokensCss } from "@copayme/shared";
import Nav from "@/components/Nav";

const sans = Archivo({ subsets: ["latin"], weight: ["500", "600", "700", "800", "900"], variable: "--font-sans", display: "swap" });
// Fall back to a real monospaced font (not next/font's size-adjusted Arial) so receipts stay monospaced while it loads.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "coPAYMe",
  description: "A score for sports predictors, measured against the market.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <style dangerouslySetInnerHTML={{ __html: tokensCss(":root", TOKENS) }} />
        <Nav />
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <span>coPAYMe</span>
            <span className="muted">Scores are measured against market odds.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
