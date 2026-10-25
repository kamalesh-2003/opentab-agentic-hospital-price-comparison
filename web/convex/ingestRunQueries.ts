import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Queries must live outside "use node" files.
export const job = internalQuery({
  args: { jobId: v.id("ingestJobs") },
  handler: (ctx, { jobId }) => ctx.db.get(jobId),
});

export const nearbyPoint = internalQuery({
  args: { nearbyId: v.id("nearby") },
  handler: async (ctx, { nearbyId }) => {
    const n = await ctx.db.get(nearbyId);
    return n ? { lat: n.lat, lon: n.lon } : null;
  },
});
