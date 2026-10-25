import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const STATUS = v.union(
  v.literal("queued"),
  v.literal("searching"),
  v.literal("fetching"),
  v.literal("parsing"),
  v.literal("indexing"),
  v.literal("done"),
  v.literal("failed"),
);

/** ADD ANY HOSPITAL: create a job; the UI subscribes to it for live stages. */
export const addHospital = mutation({
  args: { hospitalName: v.string(), domain: v.optional(v.string()) },
  handler: async (ctx, { hospitalName, domain }) => {
    const name = hospitalName.trim().slice(0, 120);
    if (name.length < 3) throw new Error("Type a hospital name, e.g. St. Rose Hospital Hayward");
    const cleanDomain = domain?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || undefined;
    // Avoid a second run for the same hospital while one is in progress.
    const recent = await ctx.db.query("ingestJobs").withIndex("by_created").order("desc").take(20);
    const running = recent.find((j) => j.hospitalName.toLowerCase() === name.toLowerCase() && !["done", "failed"].includes(j.status));
    if (running) return running._id;
    const now = Date.now();
    const id = await ctx.db.insert("ingestJobs", {
      hospitalName: name,
      domain: cleanDomain,
      status: "queued",
      detail: "Starting…",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.ingestRun.run, { jobId: id });
    return id;
  },
});

export const update = internalMutation({
  args: {
    jobId: v.id("ingestJobs"),
    status: STATUS,
    detail: v.string(),
    apifyRunId: v.optional(v.string()),
    prices: v.optional(v.number()),
    procedures: v.optional(v.number()),
    hospitalNames: v.optional(v.array(v.string())),
    partial: v.optional(v.boolean()),
    via: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    await ctx.db.patch(jobId, { ...clean, updatedAt: Date.now() });
  },
});

export const get = query({
  args: { jobId: v.id("ingestJobs") },
  handler: (ctx, { jobId }) => ctx.db.get(jobId),
});

export const recent = query({
  args: {},
  handler: (ctx) => ctx.db.query("ingestJobs").withIndex("by_created").order("desc").take(5),
});
