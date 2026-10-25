# Hospital Price Transparency Parser

US hospitals must publish their real prices (gross charges, discounted cash prices, and the rates they negotiated with each insurer) in machine-readable files under the CMS Hospital Price Transparency rule. These files are often hundreds of MB to several GB and hard to use.

This Actor turns them into clean, comparable records for the procedures people actually shop for.

## What it does

1. **Finds the files.** Given a hospital **domain**, it reads `https://<domain>/cms-hpt.txt` (the CMS-required index of price files). Given only a **hospital name**, it uses Bright Data SERP API to find the official site first, and checks that the file it finds matches that hospital.
2. **Fetches them reliably.** It downloads directly first. If a site blocks or times out, it retries through **Bright Data Web Unlocker**. A clean 404 is treated as "not here" and is not retried.
3. **Stream-parses them.** It handles CMS template JSON (v2/v3), CSV "tall", CSV "wide", and zip/gzip, without loading the whole file into memory. Fast prefiltering readers run about 40-66 MB/s, so a 343 MB CSV takes about 5 seconds.
4. **Normalizes the results.** Insurer names are mapped to canonical names (for example, "BLUE SHIELD OF CA" and "Blue Shield CA PPO" both become Blue Shield of California). Each rate is tagged with a plan type: commercial, Medicare Advantage, Medi-Cal, or exchange.
5. **Stays inside a budget.** It stops at a time or byte budget and marks the results as `partial`, so live runs finish quickly.

## Input

| Field | Example | Notes |
|---|---|---|
| `domain` | `ucsfhealth.org` | Reads cms-hpt.txt at that host |
| `hospitalName` | `Kaiser Permanente San Francisco Medical Center` | Used for SERP discovery and to pick matching locations |
| `fileUrl` | `https://.../standardcharges.json` | Skips discovery |
| `locationFilter` | `San Francisco` | Keeps only matching cms-hpt.txt locations |
| `codes` | `["73721","45378"]` | Empty means 23 common shoppable CPT codes |
| `timeBudgetSec` / `byteBudgetMb` | `60` / `500` | Results are marked `partial` if a budget is hit |
| `maxFiles` | `3` | Number of distinct price files to process |

## Output

The **dataset** has one record per price:

`hospital_name, hospital_location, address, source_url, file_last_updated, partial, code, code_type, description, setting, gross_charge, discounted_cash, payer_name, payer_normalized, plan_name, plan_type, negotiated_dollar, negotiated_percentage, negotiated_algorithm, methodology, median_amount, min_negotiated, max_negotiated`

The **key-value store `OUTPUT`** holds an honest run summary: status (`ok`, `partial`, `empty` or `failed`), a plain-English message, per-file format, bytes read, items scanned, and what was blocked or skipped.

## Notes and limits

- These are the hospital's published estimates, not a quote. Patient cost depends on deductible and coinsurance.
- Many hospitals publish commercial rates as formulas or percentages instead of dollar amounts. Those appear in `negotiated_percentage` and `negotiated_algorithm`, never as a guessed dollar figure.
- Excel price files are not supported yet. They are reported clearly in the run summary.
- Bright Data is optional. Without `BRIGHTDATA_API_KEY`, `BRIGHTDATA_SERP_ZONE` and `BRIGHTDATA_UNLOCKER_ZONE`, the Actor fetches directly only.

Built for **OpenTab** ("Know the bill before you get the bill") at Cal Hacks 13.0.
