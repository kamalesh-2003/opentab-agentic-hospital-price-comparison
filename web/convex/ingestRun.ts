"use node";
// Runs one ADD-HOSPITAL job: Apify Actor (Bright Data SERP + Unlocker inside) -> live stages -> Elastic.
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { indexRecords } from "./lib/indexer";

const ACTOR = () => `${process.env.APIFY_USERNAME?.trim()}~hospital-price-transparency-parser`;

async function apify(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.apify.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN?.trim()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

type Stage = "searching" | "fetching" | "parsing";

/** The Actor reports progress as "<stage>: <detail>" via setStatusMessage. */
function stageOf(msg: string | undefined): { stage: Stage; detail: string } | null {
  const m = msg?.match(/^(searching|fetching|parsing):\s*([\s\S]*)$/);
  return m ? { stage: m[1] as Stage, detail: m[2] } : null;
}

export const run = internalAction({
  args: { jobId: v.id("ingestJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(internal.ingestRunQueries.job, { jobId });
    if (!job) return;
    type Patch = {
      status: "searching" | "fetching" | "parsing" | "indexing" | "done" | "failed";
      detail: string;
      apifyRunId?: string;
      prices?: number;
      procedures?: number;
      hospitalNames?: string[];
      partial?: boolean;
      via?: string;
    };
    const set = (patch: Patch) => ctx.runMutation(internal.ingest.update, { jobId, ...patch });

    try {
      await set({ status: "searching", detail: job.domain ? `Looking for ${job.domain}/cms-hpt.txt` : `Searching the web for ${job.hospitalName}'s official site (Bright Data SERP)` });
      const input = { hospitalName: job.hospitalName, domain: job.domain, timeBudgetSec: 60, byteBudgetMb: 800, maxFiles: 2 };
      const { data: started } = await apify(`/v2/acts/${ACTOR()}/runs?timeout=240&memory=2048`, { method: "POST", body: JSON.stringify(input) });
      await set({ status: "searching", detail: "Apify Actor started", apifyRunId: started.id });

      // Poll the run and mirror its status message as live stages.
      let runInfo = started;
      let lastMsg = "";
      const deadline = Date.now() + 260_000;
      while (["READY", "RUNNING"].includes(runInfo.status) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        runInfo = (await apify(`/v2/actor-runs/${started.id}`)).data;
        const s = stageOf(runInfo.statusMessage);
        if (s && runInfo.statusMessage !== lastMsg) {
          lastMsg = runInfo.statusMessage;
          await set({ status: s.stage, detail: s.detail });
        }
      }

      const summary = await apify(`/v2/key-value-stores/${runInfo.defaultKeyValueStoreId}/records/OUTPUT`).catch(() => null);
      if (!summary || summary.status === "failed" || summary.status === "empty" || !["SUCCEEDED"].includes(runInfo.status)) {
        const why =
          summary?.message ??
          (runInfo.status === "TIMED-OUT" ? "The hospital's file took too long to download." : `The ingest run ended with status ${runInfo.status}.`);
        await set({ status: "failed", detail: why });
        return;
      }

      await set({ status: "indexing", detail: `Indexing ${summary.records.toLocaleString()} prices into Elastic` });
      const records: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 5000) {
        const page = await apify(`/v2/datasets/${runInfo.defaultDatasetId}/items?clean=true&limit=5000&offset=${offset}`);
        records.push(...page);
        if (page.length < 5000) break;
      }
      const viaBrightData = (summary.files ?? []).some((f: { via?: string }) => f.via === "brightdata") || /brightdata/.test(JSON.stringify(summary.log ?? []));
      const hospitals = await indexRecords(records as never, "apify-live");
      const total = hospitals.reduce((a, h) => a + h.indexed, 0);
      await set({
        status: "done",
        detail: `${total.toLocaleString()} prices for ${summary.codes_found.length} procedures indexed${summary.status === "partial" ? " (partial file)" : ""}`,
        prices: total,
        procedures: summary.codes_found.length,
        hospitalNames: hospitals.map((h) => h.name),
        partial: summary.status === "partial",
        via: viaBrightData ? "Bright Data Unlocker" : "direct download",
      });
    } catch (err) {
      await set({ status: "failed", detail: `Something went wrong: ${(err as Error).message.slice(0, 200)}` });
    }
  },
});
