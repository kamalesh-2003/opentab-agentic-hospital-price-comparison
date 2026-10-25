import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Local dev: also read the repo-root .env.local (single source of keys). Values already set
// (e.g. Vercel project env vars) win. @next/env caches its first load, so parse it here directly.
const rootEnv = path.resolve(__dirname, "..", ".env.local");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const nextConfig: NextConfig = {
  // Only public values reach the browser bundle; all API keys stay in Convex.
  env: { NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL ?? "" },
};

export default nextConfig;
