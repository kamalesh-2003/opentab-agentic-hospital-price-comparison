// Discovery-only probe: for each domain, fetch cms-hpt.txt and peek at the first bytes of each price file.
// Usage: npx tsx --env-file=../.env.local scripts/probe.ts domain1 domain2 ...
import { discoverFromDomain } from "../src/discover.js";
import { openUrl } from "../src/fetcher.js";

const domains = process.argv.slice(2);
await Promise.all(
  domains.map(async (d) => {
    const log: string[] = [];
    const found = await discoverFromDomain(d, log);
    if (!found) return console.log(`\n### ${d}: NOT FOUND\n  ${log.join("\n  ")}`);
    const urls = [...new Set(found.entries.map((e) => e.mrf_url))];
    const lines = [`\n### ${d}: ${found.entries.length} locations, ${urls.length} files (cms-hpt via ${found.via})`];
    for (const u of urls.slice(0, 4)) {
      const locs = found.entries.filter((e) => e.mrf_url === u).map((e) => e.location_name).join("; ");
      try {
        const o = await openUrl(u, { headerTimeoutMs: 20000 });
        const it = o.body[Symbol.asyncIterator]();
        const first = (await it.next()).value as Buffer;
        o.body.destroy();
        const head = first.subarray(0, 4);
        const kind = head[0] === 0x1f ? "gzip" : head[0] === 0x50 && head[1] === 0x4b ? "zip" : JSON.stringify(first.toString("utf8", 0, 60));
        lines.push(`  [${o.via}] ${o.contentLength ? Math.round(o.contentLength / 1e6) + "MB" : "?MB"} ${kind}\n     ${locs.slice(0, 120)}\n     ${u.slice(0, 140)}`);
      } catch (err) {
        lines.push(`  FAIL ${(err as Error).message.slice(0, 200)}\n     ${locs.slice(0, 120)}\n     ${u.slice(0, 140)}`);
      }
    }
    if (urls.length > 4) lines.push(`  ... ${urls.length - 4} more files`);
    console.log(lines.join("\n"));
  }),
);
