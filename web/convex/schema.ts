import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// No user accounts and no personal health information: searches keep only the
// resolved procedure/payer (never the raw question text).
export default defineSchema({
  searches: defineTable({
    procedureCode: v.string(),
    procedureLabel: v.string(),
    payer: v.optional(v.string()),
    planType: v.optional(v.string()),
    hospitals: v.number(),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  ingestJobs: defineTable({
    hospitalName: v.string(),
    domain: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("searching"),
      v.literal("fetching"),
      v.literal("parsing"),
      v.literal("indexing"),
      v.literal("done"),
      v.literal("failed"),
    ),
    detail: v.string(),
    apifyRunId: v.optional(v.string()),
    prices: v.optional(v.number()),
    procedures: v.optional(v.number()),
    hospitalNames: v.optional(v.array(v.string())),
    partial: v.optional(v.boolean()),
    via: v.optional(v.string()),
    /** Set when the job was started automatically for a hospital found near a user. */
    nearbyId: v.optional(v.id("nearby")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_status", ["status"]),

  /** Hospitals discovered near users via OpenStreetMap, and whether we have their prices. */
  nearby: defineTable({
    osmId: v.string(),
    name: v.string(),
    lat: v.number(),
    lon: v.number(),
    domain: v.optional(v.string()),
    city: v.optional(v.string()),
    status: v.union(v.literal("new"), v.literal("ingesting"), v.literal("indexed"), v.literal("no_data"), v.literal("failed")),
    detail: v.optional(v.string()),
    jobId: v.optional(v.id("ingestJobs")),
    triedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_osm", ["osmId"])
    .index("by_lat", ["lat"]),

  /** Map tiles already scanned for hospitals (so we query OpenStreetMap at most once a day per area). */
  scans: defineTable({ tile: v.string(), at: v.number(), found: v.number() }).index("by_tile", ["tile"]),
});
