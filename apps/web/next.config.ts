import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The shared package ships TypeScript source, so Next compiles it (for the tweet text parser).
  transpilePackages: ["@copayme/shared"],
  env: {
    API_URL: process.env.API_URL ?? "http://localhost:8787",
    TRADING_URL: process.env.TRADING_URL ?? "http://localhost:8788",
  },
};

export default config;
