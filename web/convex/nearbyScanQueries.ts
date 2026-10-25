import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Hospitals near a point that still need a live ingest, nearest first. */
export const waitingNear = internalQuery({
  args: { lat: v.number(), lon: v.number(), radiusKm: v.number() },
  handler: async (ctx, { lat, lon, radiusKm }) => {
    const dLat = radiusKm / 111;
    const rows = await ctx.db
      .query("nearby")
      .withIndex("by_lat", (q) => q.gte("lat", lat - dLat).lte("lat", lat + dLat))
      .collect();
    const dist = (r: { lat: number; lon: number }) => Math.hypot((r.lat - lat) * 111, (r.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180));
    const inR = rows.filter((r) => dist(r) <= radiusKm);
    return {
      total: inR.length,
      indexed: inR.filter((r) => r.status === "indexed").length,
      waiting: inR.filter((r) => r.status === "new").sort((a, b) => dist(a) - dist(b)),
    };
  },
});
