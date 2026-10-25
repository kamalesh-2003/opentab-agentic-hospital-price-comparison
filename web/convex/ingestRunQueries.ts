import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Queries must live outside "use node" files.
export const job = internalQuery({
  args: { jobId: v.id("ingestJobs") },
  handler: (ctx, { jobId }) => ctx.db.get(jobId),
});
