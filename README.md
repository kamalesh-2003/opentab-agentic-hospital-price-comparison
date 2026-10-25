# OpenTab: know the bill before you get the bill

**Live:** https://opentab.health · Built at Cal Hacks 13.0

OpenTab is a voice-first map that shows what hospitals near you **actually charge** for MRIs, CT scans, X-rays and ultrasounds. You can compare your insurer's negotiated rate with the cash price. Every number links to the hospital's own price file.

> *"How much is a lower back MRI if I pay cash?"* → pins on the map turn into price tags, OpenTab says *"The lowest published cash price is $X at Y; prices run up to $Z"*, and each card links to the source file.

## The problem

Since 2021, US hospitals must publish machine-readable files with every price they charge. That includes gross charges, discounted cash prices, and the rate negotiated with each insurer. The files are real and legally required. They're also unusable for a normal person: hundreds of MB to several GB of JSON or CSV, in three different layouts, hidden behind `cms-hpt.txt` index files.

Our data shows the same scan varies enormously within one metro area. Figures are from the published files; see [DEMO.md](DEMO.md) for the exact, re-checkable examples:
- Knee MRI, cash price: from about **$1,000 to over $25,000** across Bay Area hospitals.
- Knee MRI, Blue Shield negotiated rate: **about 18×** between the cheapest and most expensive hospital.
- At some hospitals, the **cash price is lower than the insurer's rate**.

## Who it's for

**Patients trying to save money on radiology when insurance doesn't work out:** people on high-deductible plans, people whose insurer denied a scan, people who are out of network or uninsured. Imaging is the most "shoppable" care: you usually get a referral, then choose where to go.

## What it does

- **Ask by voice or text.** Cartesia streaming speech-to-text hears the question, and a two-sentence answer is spoken back.
- **The map is the answer.** Hospitals within about 25 miles of you (widening to 60 if needed) become green-to-red price tags. Grey means "not published."
- **Cash vs. your plan.** Each card shows your insurer's negotiated rate (median and range), the cash price, the list price, "save $X vs. the most expensive," and a warning when cash beats your plan.
- **Insurers with published rates** at each hospital, as evidence of a contract. We say "likely in network; call to confirm," never "accepts your insurance."
- **Works anywhere in the US.** When you open the map somewhere new, OpenTab finds nearby hospitals in our CMS directory (4,600+ hospitals) and **reads their price files live**. Pins pulse purple while files load, then fill in.
- **Add any hospital.** Type a name, then watch it move through Searching → Fetching → Parsing → Indexed in about 30 seconds.
- **Sources everywhere.** Every number shows its price file link and the file's last-updated date. Partial reads are labeled.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["opentab.health (Next.js on Vercel)"]
    UI[Map UI · Leaflet + OSM]
    MIC[Mic · Cartesia STT ink-whisper]
    TTS[Spoken answer · Cartesia Sonic-3]
  end
  subgraph Convex["Convex backend"]
    ASK[ask action]
    SCAN[nearbyScan action]
    JOBS[(ingestJobs · nearby · searches)]
    RUN[ingestRun action]
    TOK[voice token action]
  end
  subgraph Elastic["Elastic Serverless"]
    PRICES[(opentab-prices)]
    HOSP[(opentab-hospitals)]
    DIR[(opentab-directory · CMS)]
    PROC[(opentab-procedures · synonyms)]
    AB[Agent Builder: OpenTab Advisor + 4 ES|QL tools + MCP server]
  end
  CLAUDE[Claude Opus 5.5]
  APIFY[Apify Actor: hospital-price-transparency-parser]
  BD[Bright Data SERP + Web Unlocker]
  HOSPWEB[(Hospital sites: cms-hpt.txt → price files)]

  MIC -- 60s token --> TOK
  UI --> ASK
  ASK -- parse question --> CLAUDE
  ASK -- tools/_execute --> AB
  AB --> PRICES & PROC
  ASK -- 2-sentence summary, number-checked --> CLAUDE
  AB -. "LLM connector (inference endpoint)" .-> CLAUDE
  UI --> SCAN --> DIR & HOSP
  SCAN --> JOBS --> RUN
  RUN -- start run, mirror live stages --> APIFY
  APIFY -- find site / unblock fetch --> BD --> HOSPWEB
  APIFY -- stream-parse JSON/CSV/zip --> HOSPWEB
  RUN -- index + geocode --> PRICES & HOSP
  JOBS -- live status (reactive) --> UI
```

## Sponsor tracks

Each one is load-bearing; take any away and a core flow breaks.

**Bright Data.** It's the live web-data layer. When someone adds a hospital by name, **SERP API** finds its official domain ([`actor/src/brightdata.ts`](actor/src/brightdata.ts), [`actor/src/discover.ts`](actor/src/discover.ts)). We send two parallel requests and keep the first good one, because we measured SERP latency at 5–15 s with occasional 45 s stalls. When a hospital site blocks or times out, **Web Unlocker** fetches `cms-hpt.txt` and the price file instead ([`actor/src/fetcher.ts`](actor/src/fetcher.ts)). Zuckerberg SF General and St. Rose only load that way. A clean 404 is not retried through the unblocker.

**Apify.** Our TypeScript Actor, [`actor/`](actor/), is deployed on the Apify platform. It takes a hospital name, domain or file URL, discovers files through `cms-hpt.txt`, and **stream-parses** CMS JSON (v2/v3), tall CSV, wide CSV, zip and gzip within a time/byte budget. Its custom readers run at about 43–66 MB/s, versus 2–4 MB/s for generic parsers; see [`fastcsv.ts`](actor/src/fastcsv.ts) and [`fastjson.ts`](actor/src/fastjson.ts). It outputs normalized records plus an honest run summary, and reports live stages through `setStatusMessage`, which the app mirrors in real time. Every Bay Area hospital was pre-ingested through Apify runs, and the live "add a hospital" and "nearby" flows start Apify runs too.

**Elastic.** Elastic Serverless stores the normalized prices, hospitals, a 4,627-hospital CMS directory, and a procedures/synonyms index, all with explicit mappings ([`elastic/setup.mjs`](elastic/setup.mjs), [`elastic/directory.mjs`](elastic/directory.mjs)). **Agent Builder** hosts the *OpenTab Advisor* agent and four **ES|QL tools**: `lookup_procedure`, `compare_procedure`, `cash_prices` and `list_payers` ([`elastic/agent-setup.mjs`](elastic/agent-setup.mjs)). The web app calls the *same* tools through `tools/_execute` in about 0.2–0.8 s, so the app, the agent and MCP clients always see identical numbers. The tools are exposed through Agent Builder's **MCP server** and verified with [`elastic/mcp-client.mjs`](elastic/mcp-client.mjs).

**Claude (Anthropic).** Claude Opus 5.5 is the model behind the Agent Builder agent, via an Elastic `anthropic` inference endpoint. In the app ([`web/convex/lib/claude.ts`](web/convex/lib/claude.ts)) it does two things:
1. It turns speech into a structured search using structured outputs. The procedure code and insurer must come from fixed enums, so Claude can't invent a code.
2. It writes the two-sentence spoken answer from numbers we computed. Every dollar figure it says is checked against those numbers.

**Convex.** The backend for everything live ([`web/convex/`](web/convex)):
- the `ask` action, which orchestrates Claude, Agent Builder and the ranking;
- the ingest **job queue**, whose Apify stages stream to the UI through reactive queries;
- nearby discovery (`nearby`, `scans`), which tracks per-area which hospitals are indexed, loading or missing data;
- the Cartesia token minting.

It also stores recent searches (procedure and insurer only, never the question text).

**Cartesia.** Voice is the primary interface ([`web/src/components/useVoice.ts`](web/src/components/useVoice.ts), [`web/convex/voice.ts`](web/convex/voice.ts)).

## Cartesia: features used and limitations

- **Streaming STT (`ink-whisper`)** over `wss://api.cartesia.ai/stt/websocket`: the browser streams 16 kHz PCM in about 100 ms chunks from an AudioWorklet. We stop after about 1.3 s of silence, send `finalize`, and assemble the final transcript from `is_final` deltas.
- **TTS (`sonic-3`, voice "Skylar")** via `/tts/bytes`, returned as MP3.
- **Short-lived access tokens**: a Convex action mints a 60-second token with only the `stt` and `tts` grants, so the API key never reaches the browser.
- **Limitations we hit and handled:**
  - Phones block audio that doesn't start from a tap, so we unlock an audio element during the mic tap and reuse it for the answer.
  - Firefox can't record into a 16 kHz `AudioContext`, so we fall back to the device rate and downsample in JS.
  - Speech-to-text can mishear procedure names, so Claude's parsing is told to interpret generously, and it can only choose from our procedure list.

## Where Claude can go wrong, and our safeguards

| Risk | Safeguard |
|---|---|
| Inventing a price | Claude never produces prices. Numbers come from ES\|QL tools over hospital files. Every `$` in the spoken summary is checked against the computed set; on any mismatch we use a template sentence instead. |
| Inventing a procedure code or insurer | Structured outputs with **enums**: Claude picks a code and insurer from fixed lists, or "none". |
| Inventing coordinates for a place | Claude only extracts the place text. A real geocoder (OpenStreetMap Nominatim) or our fixed table resolves it, and unknown places return an error. |
| Saying "your insurance is accepted" | We say "published rates here (likely in network); call to confirm." Absence of a rate is shown as "may be out of network," never as a fact. |
| Treating odd rows as scan prices | Per-diem and percent-of-charges rows are excluded from plan rates. Medicare Advantage abbreviations (`MCR ADV`, `MCARE`) are classified so they never pass as commercial rates. Cash is shown as a **median with range**, so one strange row can't become the headline. |
| Stale or partial data | Every card shows the file's last-updated date, and partial reads are labeled. |
| Refusals | Server-side refusal fallback (`fallbacks: "default"`). If parsing fails anyway, the user gets a clear message, not a guess. |
| Health privacy | No accounts. Questions are not stored; only the resolved procedure and insurer are kept, for "recent searches." |

## Data notes

- **Many hospitals publish commercial rates as formulas** (percent of charges, APC-based) instead of dollars. We show those as **"not published"** rather than estimating.
- **Hospital prices usually exclude** separately billed radiologist fees.
- **Coordinates:** the directory uses ZIP-code centroids from the US Census, and indexed hospitals are geocoded by address.

## Repo layout

| Path | What |
|---|---|
| `web/` | Next.js 15 app (App Router, TS, Tailwind, Leaflet) and the Convex backend in `web/convex/` |
| `actor/` | Apify Actor (TypeScript): discovery, fetch with Bright Data fallback, streaming parsers |
| `elastic/` | Index setup, CMS directory builder, ingest, Agent Builder tools/agent, MCP client check |
| `scripts/check-keys.mjs` | Verifies every API key without printing secrets |
| `data/` | None. There is no mocked price data anywhere. |

## Setup

1. Copy `.env.example` to `.env.local` and fill it in. Check with `node --env-file=.env.local scripts/check-keys.mjs`.
2. **Elastic:**
   - `node --env-file=.env.local elastic/setup.mjs` (indices and procedures)
   - `node --env-file=.env.local elastic/directory.mjs <Census 2025_Gaz_zcta_national.txt>` (US directory)
   - `node --env-file=.env.local elastic/agent-setup.mjs` (Claude endpoint, tools, agent)
   - `cd elastic && npm i && npm run mcp-check`
3. **Apify:** `cd actor && npm i && npx apify-cli login && npx apify-cli secrets add brightdataApiKey <key> && npx apify-cli push`
4. **Pre-ingest:** `node --env-file=.env.local elastic/preingest.mjs` (Apify runs; add `--local` to run on your machine)
5. **Convex:** `cd web && npm i`, then `npx convex deploy` with `CONVEX_DEPLOY_KEY`. Set the server env vars with `npx convex env set --from-file <file>`: `ANTHROPIC_API_KEY`, `ELASTIC_URL`, `ELASTIC_API_KEY`, `KIBANA_URL`, `APIFY_TOKEN`, `APIFY_USERNAME`, `BRIGHTDATA_*` and `CARTESIA_API_KEY`.
6. **Vercel:** set Root Directory to `web`. Set `CONVEX_DEPLOY_KEY` and `NEXT_PUBLIC_CONVEX_URL`. The build command in `web/vercel.json` deploys Convex, then Next.js.

*Published estimates, not a quote. OpenTab is not medical or financial advice.*
