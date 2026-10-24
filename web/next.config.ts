import type { NextConfig } from "next";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

// Local dev: also read the repo-root .env.local (single source of keys).
// On Vercel, env vars come from the project settings instead.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {};

export default nextConfig;
