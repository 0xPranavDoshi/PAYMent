import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "coPAYMe",
  description: "Copy-trade the sharpest sports predictors.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container" style={{ paddingTop: 24, paddingBottom: 48 }}>
          {children}
        </main>
      </body>
    </html>
  );
}
