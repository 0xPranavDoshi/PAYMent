import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { TWEET_CARD_CSS } from "@copayme/tweet-card";
import Nav from "@/components/Nav";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "coPAYMe",
  description: "A score for sports predictors, measured against the market.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <style dangerouslySetInnerHTML={{ __html: TWEET_CARD_CSS }} />
        <Nav />
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <span>coPAYMe</span>
            <span className="muted">Scores are measured against market odds. Copy trades are simulated.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
