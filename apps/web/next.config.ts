import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The shared package ships TypeScript source, so Next compiles it (the tweet text helpers and the shared tweet card).
  transpilePackages: ["@copayme/shared", "@copayme/tweet-card"],
  // Workspace packages write relative imports the TypeScript way ("./x.js" for ./x.ts); map them for webpack.
  webpack: (config) => {
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  env: {
    API_URL: process.env.API_URL ?? "http://localhost:8787",
    TRADING_URL: process.env.TRADING_URL ?? "http://localhost:8788",
  },
};

export default config;
