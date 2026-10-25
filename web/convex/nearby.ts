import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/** Max live ingest jobs running at once (Apify memory + demo stability). */
export const MAX_RUNNING = 4;

const kmBetween = (a: [number, number], b: [number, number]) => {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/** Discovered hospitals within a radius (for map pins and live status). */
export const inArea = query({
  args: { lat: v.number(), lon: v.number(), radiusKm: v.number() },
  handler: async (ctx, { lat, lon, radiusKm }) => {
    const dLat = radiusKm / 111;
    const rows = await ctx.db
      .query("nearby")
      .withIndex("by_lat", (q) => q.gte("lat", lat - dLat).lte("lat", lat + dLat))
      .collect();
    return rows
      .map((r) => ({ ...r, distanceKm: kmBetween([lat, lon], [r.lat, r.lon]) }))
      .filter((r) => r.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  },
});

export const scanInfo = internalQuery({
  args: { tile: v.string(), osmIds: v.array(v.string()) },
  handler: async (ctx, { tile, osmIds }) => {
    const scan = await ctx.db
      .query("scans")
      .withIndex("by_tile", (q) => q.eq("tile", tile))
      .first();
    const known: Record<string, { id: Id<"nearby">; status: string; triedAt?: number }> = {};
    for (const osmId of osmIds) {
      const r = await ctx.db
        .query("nearby")
        .withIndex("by_osm", (q) => q.eq("osmId", osmId))
        .first();
      if (r) known[osmId] = { id: r._id, status: r.status, triedAt: r.triedAt };
    }
    const running = (await ctx.db.query("ingestJobs").collect()).filter((j) => !["done", "failed"].includes(j.status) && Date.now() - j.updatedAt < 5 * 60_000).length;
    return { scannedAt: scan?.at ?? null, known, running };
  },
});

export const lastScan = internalQuery({
  args: { tile: v.string() },
  handler: async (ctx, { tile }) =>
    (
      await ctx.db
        .query("scans")
        .withIndex("by_tile", (q) => q.eq("tile", tile))
        .first()
    )?.at ?? null,
});

/** Upsert discovered hospitals; mark ones we already have prices for as indexed. */
export const upsert = internalMutation({
  args: {
    tile: v.string(),
    rows: v.array(
      v.object({
        osmId: v.string(),
        name: v.string(),
        lat: v.number(),
        lon: v.number(),
        domain: v.optional(v.string()),
        city: v.optional(v.string()),
        indexed: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, { tile, rows }) => {
    const now = Date.now();
    for (const { indexed, ...r } of rows) {
      const cur = await ctx.db
        .query("nearby")
        .withIndex("by_osm", (q) => q.eq("osmId", r.osmId))
        .first();
      if (!cur) {
        await ctx.db.insert("nearby", { ...r, status: indexed ? "indexed" : "new", updatedAt: now });
      } else if (indexed && cur.status !== "indexed") {
        await ctx.db.patch(cur._id, { status: "indexed", updatedAt: now });
      }
    }
    const scan = await ctx.db
      .query("scans")
      .withIndex("by_tile", (q) => q.eq("tile", tile))
      .first();
    if (scan) await ctx.db.patch(scan._id, { at: now, found: rows.length });
    else await ctx.db.insert("scans", { tile, at: now, found: rows.length });
  },
});

/** Start live ingest jobs for the given discovered hospitals (nearest first), respecting MAX_RUNNING. */
export const enqueue = internalMutation({
  args: { ids: v.array(v.id("nearby")) },
  handler: async (ctx, { ids }) => {
    const running = (await ctx.db.query("ingestJobs").collect()).filter((j) => !["done", "failed"].includes(j.status) && Date.now() - j.updatedAt < 5 * 60_000).length;
    let slots = Math.max(0, MAX_RUNNING - running);
    let started = 0;
    for (const id of ids) {
      if (slots <= 0) break;
      const n = await ctx.db.get(id);
      if (!n || n.status !== "new") continue;
      const now = Date.now();
      const jobId = await ctx.db.insert("ingestJobs", {
        hospitalName: n.city ? `${n.name}, ${n.city}` : n.name,
        domain: n.domain,
        status: "queued",
        detail: "Queued",
        nearbyId: n._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(n._id, { status: "ingesting", jobId, triedAt: now, detail: "Finding the price file…", updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.ingestRun.run, { jobId });
      slots--;
      started++;
    }
    return started;
  },
});

/** Called by the ingest job when it finishes. Starts the next waiting hospital, if any. */
export const finish = internalMutation({
  args: { nearbyId: v.id("nearby"), status: v.union(v.literal("indexed"), v.literal("no_data"), v.literal("failed")), detail: v.string() },
  handler: async (ctx, { nearbyId, status, detail }) => {
    const n = await ctx.db.get(nearbyId);
    if (!n) return;
    await ctx.db.patch(nearbyId, { status, detail, updatedAt: Date.now() });
    // Keep the pipeline full: start the nearest waiting hospital in the same area.
    const dLat = 40 / 111;
    const waiting = (
      await ctx.db
        .query("nearby")
        .withIndex("by_lat", (q) => q.gte("lat", n.lat - dLat).lte("lat", n.lat + dLat))
        .collect()
    )
      .filter((r) => r.status === "new")
      .sort((a, b) => kmBetween([n.lat, n.lon], [a.lat, a.lon]) - kmBetween([n.lat, n.lon], [b.lat, b.lon]))
      .slice(0, 2)
      .map((r) => r._id);
    if (waiting.length) await ctx.scheduler.runAfter(0, internal.nearby.enqueue, { ids: waiting });
  },
});
