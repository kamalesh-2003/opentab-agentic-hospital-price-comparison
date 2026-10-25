import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Stores only the resolved procedure and insurer, never the raw question (no health information). */
export const record = internalMutation({
  args: {
    procedureCode: v.string(),
    procedureLabel: v.string(),
    payer: v.optional(v.string()),
    planType: v.optional(v.string()),
    hospitals: v.number(),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("searches", { ...a, createdAt: Date.now() });
  },
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("searches").withIndex("by_created").order("desc").take(30);
    // De-duplicate so the chips show variety.
    const seen = new Set<string>();
    return rows
      .filter((r) => {
        const k = `${r.procedureCode}|${r.payer ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 6);
  },
});
