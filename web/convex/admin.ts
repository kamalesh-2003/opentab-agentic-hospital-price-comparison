import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Dev helper: forget discovered hospitals and scans so the next scan re-matches from scratch. */
export const resetNearby = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const r of await ctx.db.query("nearby").collect()) if (r.status !== "ingesting") await ctx.db.delete(r._id);
    for (const r of await ctx.db.query("scans").collect()) await ctx.db.delete(r._id);
  },
});

/** Dev helper: put no_data/failed hospitals whose name matches `match` back in the queue. */
export const retry = internalMutation({
  args: { match: v.string() },
  handler: async (ctx, { match }) => {
    const re = new RegExp(match, "i");
    let n = 0;
    for (const r of await ctx.db.query("nearby").collect()) {
      if ((r.status === "no_data" || r.status === "failed") && re.test(r.name)) {
        await ctx.db.patch(r._id, { status: "new", detail: undefined, updatedAt: Date.now() });
        n++;
      }
    }
    return n;
  },
});
