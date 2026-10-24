# Setup checklist

1. Copy `.env.example` to `.env.local` at the repo root and fill in every value (see comments in the file).
2. Accounts: Anthropic, Bright Data (SERP API zone + Web Unlocker zone), Apify, Elastic Cloud Serverless
   (Elasticsearch project), Cartesia, Convex, Vercel.
3. `cd web && npx convex dev` creates the Convex deployment and writes `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL`.
4. Vercel: import the repo with **Root Directory = `web`**, and add the same env vars in project settings.
