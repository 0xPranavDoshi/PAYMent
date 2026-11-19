import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  env: {
    API_URL: process.env.API_URL ?? "http://localhost:8787",
    TRADING_URL: process.env.TRADING_URL ?? "http://localhost:8788",
  },
};

export default config;
