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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created", ["createdAt"]),
});
