# Devpost draft: OpenTab

**Tagline:** Know the bill before you get the bill. A voice-first map of real hospital prices for MRIs, CTs and X-rays, cash vs. your insurance.

**Links:** https://opentab.health · GitHub: kamalesh-2003/opentab-agentic-hospital-price-comparison · Apify Actor: *hospital-price-transparency-parser*

## Inspiration
US hospitals have had to publish every price they charge since 2021: list prices, cash prices, and what each insurer negotiated. Almost nobody uses this data, because it's buried in multi-gigabyte machine-readable files. Meanwhile, patients with high deductibles or denied claims pay whatever the first hospital bills them. We wanted to turn that legally required data into something a stressed person can use in ten seconds, by just asking.

## Who it's for
Patients trying to save money on radiology when insurance doesn't work out. Imaging is the most shoppable care, and the spreads are enormous. In San Francisco, the cash price for a lower back MRI is **$2,218** at UCSF and **$6,944** at Zuckerberg SF General, about 1.5 miles apart. For an abdominal CT, the Aetna-negotiated rate ranges from **$422 to $4,741** across Bay Area hospitals.

## What it does
- **Ask out loud:** "How much is a lower back MRI if I pay cash?" The map of hospitals around you turns into price tags, green to red, and OpenTab speaks a two-sentence answer.
- **Every card** shows your insurer's negotiated rate, the cash price, the list price, "save $X vs. the most expensive," a warning when cash beats your plan, which insurers have published rates there, the file's date, and a **link to the source file**.
- **Works anywhere in the US:** open it in a new city and it finds nearby hospitals in a 4,600-hospital CMS directory, then reads their price files live. Pins pulse while the files load.
- **Add any hospital** by name and watch it go Searching → Fetching → Parsing → Indexed in about 20–30 seconds.

## How we built it
- **Bright Data:** **SERP API** finds a hospital's official site from its name (hedged parallel requests, because SERP latency varies). **Web Unlocker** fetches `cms-hpt.txt` and price files when sites block us. Some hospitals in our data, like Zuckerberg SF General, only load through it.
- **Apify:** a custom TypeScript Actor discovers files via `cms-hpt.txt` and stream-parses CMS JSON v2/v3, tall CSV, wide CSV, zip and gzip within a time/byte budget. We wrote prefiltering readers that run at 43–66 MB/s, 10–30× faster than the generic parsers we started with. It normalizes insurers and plan types, and reports live stages. Every Bay Area hospital was ingested through Apify runs.
- **Elastic Serverless + Agent Builder:** stores the prices, hospitals, US directory and a procedure-synonym index. The *OpenTab Advisor* agent and four ES|QL tools (`lookup_procedure`, `compare_procedure`, `cash_prices`, `list_payers`) are shared by the web app, the agent and an MCP client, so everyone sees the same numbers.
- **Claude (Opus 5.5):** the model behind the Agent Builder agent, and in the app it turns speech into a structured search using enums for codes and insurers. It writes the spoken summary, and every dollar amount in it is verified against our computed numbers.
- **Convex:** the backend: the ask orchestration, the live ingest job queue streamed to the UI, nearby discovery per map area, and recent searches.
- **Cartesia:** streaming STT (`ink-whisper`) over WebSocket from an AudioWorklet, and `sonic-3` TTS, both from the browser using 60-second scoped tokens.
- **Next.js on Vercel** with Leaflet and OpenStreetMap.

## Challenges
- **Files are huge and inconsistent:** three layouts, UTF-8/UTF-16/BOMs, zipped CSVs, Box redirects, insurer names like "CIGNA HMO [1010103]", and Medicare plans abbreviated "MCR ADV" that look commercial unless you catch them.
- **Speed:** generic CSV/JSON streaming parsers managed 2–4 MB/s, too slow for a live demo, so we wrote prefiltering readers.
- **Honesty:** many hospitals publish commercial rates as formulas rather than dollars, and some rows are per-diem or component fees. We exclude those from scan prices and say "not published" rather than estimate.
- **Phones block audio** that isn't started by a tap; we unlock playback during the mic tap.

## What we're proud of
- **Real data only.** No mocked prices anywhere, a source link on every number, and an app that tells you when it doesn't know.
- **"Open it anywhere"** turns legal compliance files into a live, nationwide map.

## What's next
- Add physician and radiologist fees (published separately by insurers under Transparency in Coverage).
- Estimate the patient's share from their deductible and coinsurance.
- A phone number (Twilio + Cartesia) for people without smartphones.
- More procedure families beyond imaging.

## Built with
TypeScript, Next.js, React, Tailwind, Leaflet, OpenStreetMap, Convex, Elastic Serverless, Elastic Agent Builder, ES|QL, MCP, Apify, Bright Data, Anthropic Claude, Cartesia, Vercel, CMS Hospital Price Transparency data, CMS Provider Data, US Census Gazetteer.
