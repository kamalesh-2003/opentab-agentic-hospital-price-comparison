import { fetchText, type Via } from "./fetcher.js";
import { serpSearch } from "./brightdata.js";
import { domainOf } from "./util.js";

export interface HptEntry {
  location_name: string | null;
  source_page_url: string | null;
  mrf_url: string;
}

/** Parse cms-hpt.txt: blocks of "key: value" lines separated by blank lines. */
export function parseCmsHpt(text: string): HptEntry[] {
  const out: HptEntry[] = [];
  let cur: Record<string, string> = {};
  const flush = () => {
    if (cur["mrf-url"]) {
      out.push({
        location_name: cur["location-name"] ?? null,
        source_page_url: cur["source-page-url"] ?? null,
        mrf_url: cur["mrf-url"],
      });
    }
    cur = {};
  };
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    // A new location-name starts a new block even without a blank line.
    if (k === "location-name" && cur["location-name"]) flush();
    cur[k] = v;
  }
  flush();
  return out;
}

export interface Discovery {
  domain: string;
  hptUrl: string;
  entries: HptEntry[];
  via: Via;
  log: string[];
}

/** Try https://<domain>/cms-hpt.txt (and the www./bare variant). */
export async function discoverFromDomain(domain: string, log: string[] = []): Promise<Discovery | null> {
  const bare = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const hosts = bare.split(".").length > 2 ? [bare] : [bare, `www.${bare}`];
  for (const host of hosts) {
    const hptUrl = `https://${host}/cms-hpt.txt`;
    try {
      const { text, via, notes } = await fetchText(hptUrl);
      log.push(...notes.map((n) => `${hptUrl} ${n}`));
      const entries = parseCmsHpt(text);
      if (entries.length) {
        log.push(`${hptUrl}: ${entries.length} entries via ${via}`);
        return { domain: bare, hptUrl, entries, via, log };
      }
      log.push(`${hptUrl}: fetched via ${via} but no mrf-url entries`);
    } catch (err) {
      log.push(`${hptUrl}: ${(err as Error).message}`);
    }
  }
  return null;
}

// Sites that show up in search results but are not hospital domains.
const NOT_HOSPITAL = /(google|payerprice|hospitalpricing|pricepoint|beerepurves|fairhealth|healthcarebluebook|sidecar|wikipedia|facebook|linkedin|yelp|healthgrades|usnews|turquoise|cms\.gov|github|reddit|youtube|instagram|x\.com|twitter|glassdoor|indeed|bbb\.org|mapquest|vitals|webmd|zocdoc|patientrightsadvocate|hospitalpricingfiles|clarify)/i;

function hostOf(r: { link: string; display_link?: string }): string | null {
  // Some results are opaque google.com/goto redirects; display_link still shows the real host.
  if (/google\.[a-z.]+\/(goto|url)/.test(r.link) && r.display_link) return domainOf(r.display_link.split(" ")[0]);
  return domainOf(r.link);
}

const GENERIC = new Set(
  "hospital hospitals medical center centre health healthcare care the of and at saint st san santa francisco jose oakland bay area california ca north south east west east community regional general memorial campus clinic".split(" "),
);

/** Distinctive words of a hospital name, e.g. "Kaiser Permanente San Francisco Medical Center" -> kaiser, permanente. */
export function nameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !GENERIC.has(t));
}

/** True if the discovery plausibly belongs to the hospital the user named (guards against SERP picking a neighbor). */
export function matchesName(name: string, domain: string, entries: HptEntry[]): boolean {
  const toks = nameTokens(name);
  if (!toks.length) return true;
  const hay = `${domain} ${entries.map((e) => `${e.location_name ?? ""} ${e.mrf_url}`).join(" ")}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return toks.some((t) => hay.includes(t));
}

/** Use Bright Data SERP to find candidate official domains for a hospital name, best guesses first. */
export async function findDomains(hospitalName: string, log: string[] = []): Promise<string[]> {
  // Two searches in parallel: the plain name tends to surface the official site, the second the pricing page.
  const settled = await Promise.allSettled([
    serpSearch(`${hospitalName} hospital`),
    serpSearch(`${hospitalName} hospital price transparency standard charges`),
  ]);
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!results.length) {
    const err = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(err ? (err.reason as Error).message : "web search returned no results");
  }
  const toks = nameTokens(hospitalName);
  const scored = new Map<string, number>();
  results.forEach((r, rank) => {
    const d = hostOf(r);
    if (!d || NOT_HOSPITAL.test(d)) return;
    const root = d.split(".").slice(-2).join(".");
    const flat = d.replace(/[^a-z0-9]/g, "");
    const nameHit = toks.some((t) => flat.includes(t)) ? 100 : 0;
    // The exact host first (Kaiser publishes on healthy.kaiserpermanente.org), then its root domain.
    for (const [c, bonus] of [[d, 1], [root, 0]] as const) {
      const score = nameHit + bonus - rank * 0.5;
      if (!scored.has(c) || scored.get(c)! < score) scored.set(c, score);
    }
  });
  const ranked = [...scored.entries()].sort((x, y) => y[1] - x[1]).map(([d]) => d);
  // Domains that match the hospital name are worth trying; otherwise only the top 2 guesses.
  const named = ranked.filter((d) => toks.some((t) => d.replace(/[^a-z0-9]/g, "").includes(t)));
  const out = (named.length ? named : ranked).slice(0, named.length ? 4 : 2);
  log.push(`SERP "${hospitalName}": trying ${out.join(", ") || "(none)"}`);
  return out;
}

/** Name -> domain (SERP) -> cms-hpt.txt, rejecting files that do not mention the hospital. */
// Big systems publish one cms-hpt.txt for many hospitals, often on a domain search doesn't surface
// (Kaiser: healthy.kaiserpermanente.org). Try these before spending a Bright Data SERP call.
const SYSTEM_DOMAINS: [RegExp, string][] = [
  [/kaiser/i, "healthy.kaiserpermanente.org"],
  [/sutter|alta bates|mills.?peninsula|eden medical|cpmc|california pacific/i, "sutterhealth.org"],
  [/stanford.*(child|packard)|packard|lucile/i, "stanfordchildrens.org"],
  [/stanford/i, "stanfordhealthcare.org"],
  [/john muir/i, "johnmuirhealth.com"],
  [/\bucsf\b/i, "ucsfhealth.org"],
  [/uc davis|university of california davis/i, "health.ucdavis.edu"],
  [/el camino/i, "elcaminohealth.org"],
  [/providence/i, "providence.org"],
  [/adventist/i, "adventisthealth.org"],
  [/cedars/i, "cedars-sinai.org"],
];

export async function discoverFromName(hospitalName: string, log: string[] = []): Promise<Discovery | null> {
  for (const [re, d] of SYSTEM_DOMAINS) {
    if (!re.test(hospitalName)) continue;
    const found = await discoverFromDomain(d, log);
    if (found && matchesName(hospitalName, found.domain, found.entries)) {
      log.push(`known health system domain ${d} matched "${hospitalName}"`);
      return found;
    }
  }
  const domains = await findDomains(hospitalName, log);
  for (const d of domains) {
    const found = await discoverFromDomain(d, log);
    if (!found) continue;
    if (matchesName(hospitalName, found.domain, found.entries)) return found;
    log.push(`${found.hptUrl}: lists ${found.entries[0]?.location_name ?? "?"}, which does not match "${hospitalName}"; skipped`);
  }
  return null;
}
