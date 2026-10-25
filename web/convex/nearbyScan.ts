"use node";
// "Any location": find hospitals around a point in our US hospital directory (CMS Hospital General
// Information, 4,600+ hospitals, in Elastic), mark the ones we already have prices for, and start live
// ingest jobs (Apify Actor -> Bright Data SERP/Unlocker -> Elastic) for the nearest ones we don't.
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { es } from "./lib/elastic";
import type { Id } from "./_generated/dataModel";

type DirHit = { facility_id: string; name: string; city: string; state: string; location: { lat: number; lon: number } };
type HaveHit = { hospital_name: string; hospital_domain?: string; location?: { lat: number; lon: number } };

const STOP = new Set(["hospital", "hospitals", "medical", "center", "centre", "health", "campus", "general", "memorial", "regional", "community", "the", "and", "ctr", "hosp", "med", "system", "foundation"]);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));

export const scan = action({
  args: { lat: v.number(), lon: v.number(), radiusKm: v.optional(v.number()), autoIngest: v.optional(v.number()) },
  handler: async (ctx, { lat, lon, radiusKm = 40, autoIngest = 5 }): Promise<{ found: number; indexed: number; queued: number; cached: boolean }> => {
    // ~20 km tiles; re-check a tile at most every 6 hours.
    const tile = `${Math.round(lat * 5) / 5},${Math.round(lon * 5) / 5}`;
    const scannedAt = await ctx.runQuery(internal.nearby.lastScan, { tile });
    const fresh = scannedAt != null && Date.now() - scannedAt < 6 * 3600_000;

    if (!fresh) {
      const geo = { geo_distance: { distance: `${radiusKm}km`, location: { lat, lon } } };
      const [dir, have] = await Promise.all([
        es("POST", "/opentab-directory/_search", { size: 200, query: geo, sort: [{ _geo_distance: { location: { lat, lon }, order: "asc" } }] }),
        es("POST", "/opentab-hospitals/_search", { size: 500, _source: ["hospital_name", "hospital_domain", "location"], query: { geo_distance: { distance: `${radiusKm + 10}km`, location: { lat, lon } } } }),
      ]);
      const haveRows: HaveHit[] = (have.hits?.hits ?? []).map((h: { _source: HaveHit }) => h._source);
      const rows = (dir.hits?.hits ?? []).map((h: { _source: DirHit }) => {
        const d = h._source;
        // Directory points are ZIP centroids, so allow a few km, and require the names to share most of
        // their distinctive words (city words removed): "UCSF Saint Francis" must not match "UCSF Medical Center".
        const city = words(d.city);
        const strip = (ws: Set<string>) => new Set([...ws].filter((w) => !city.has(w)));
        const dw = strip(words(d.name));
        const indexed = haveRows.some((x) => {
          if (!x.location || km(x.location, d.location) > 8) return false;
          const xw = strip(words(x.hospital_name));
          const overlap = [...xw].filter((w) => dw.has(w)).length;
          return overlap > 0 && overlap / Math.min(xw.size, dw.size) >= 0.6 && overlap / Math.max(xw.size, dw.size) > 0.5;
        });
        return { osmId: `cms:${d.facility_id}`, name: d.name, lat: d.location.lat, lon: d.location.lon, city: `${d.city}, ${d.state}`, indexed };
      });
      await ctx.runMutation(internal.nearby.upsert, { tile, rows });
    }

    // Queue the nearest hospitals we don't have yet.
    const area = await ctx.runQuery(internal.nearbyScanQueries.waitingNear, { lat, lon, radiusKm });
    const ids = area.waiting.slice(0, autoIngest).map((w) => w._id as Id<"nearby">);
    const queued = ids.length ? await ctx.runMutation(internal.nearby.enqueue, { ids }) : 0;
    return { found: area.total, indexed: area.indexed, queued, cached: fresh };
  },
});
