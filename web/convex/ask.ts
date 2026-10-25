"use node";
// ASK flow: question -> Claude (structured parse) -> Agent Builder ES|QL tools -> ranking computed
// in code -> Claude two-sentence summary (number-checked). Claude never produces a price.
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { parseQuestion, summarize } from "./lib/claude";
import { runTool, esql, type Row } from "./lib/elastic";
import { DEFAULT_CENTER, PLAN_TYPE_LABEL, PROCEDURES, type ProcedureCode } from "./lib/catalog";
import { geocodePlace, kmBetween } from "./lib/geo";

export type HospitalResult = {
  hospitalId: string;
  name: string;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  planRate: number | null;
  planRateMin: number | null;
  planRateMax: number | null;
  cashPrice: number | null;
  grossCharge: number | null;
  /** The number we rank by: plan rate when the person has insurance and it's published, else cash. */
  price: number | null;
  priceKind: "plan" | "cash" | "none";
  savingsVsMax: number | null;
  cashBeatsPlan: boolean;
  fileLastUpdated: string | null;
  partial: boolean;
  sourceUrl: string | null;
  /** Insurers with negotiated rates published in this hospital's price file (a sign of a contract). */
  insurers: string[];
  /** Whether the person's insurer is among them (null when no insurer was given). */
  hasYourInsurer: boolean | null;
};

export type AskResult = {
  procedureCode: string;
  procedureLabel: string;
  procedureNote: string;
  payer: string | null;
  planType: string;
  planLabel: string;
  center: [number, number];
  placeName: string | null;
  radiusKm: number;
  widened: boolean;
  hospitals: HospitalResult[];
  /** Hospitals on the map that have not published this procedure (shown as grey pins). */
  notPublished: { hospitalId: string; name: string; lat: number | null; lon: number | null }[];
  cheapest: number | null;
  mostExpensive: number | null;
  spread: number | null;
  summary: string;
  summaryChecked: boolean;
  timings: Record<string, number>;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (x: Row[string]) => (typeof x === "number" ? x : x == null ? null : Number(x));

export const ask = action({
  args: { question: v.string(), lat: v.optional(v.number()), lon: v.optional(v.number()) },
  handler: async (ctx, { question, lat, lon }): Promise<AskResult> => {
    const t: Record<string, number> = {};
    let t0 = Date.now();

    // 1. Claude: question -> structured search (code / insurer / place from fixed lists)
    const parsed = await parseQuestion(question);
    t.parse = Date.now() - t0;
    if (parsed.procedure_code === "none") {
      throw new Error("I can compare 23 common procedures, like a knee MRI, colonoscopy, ER visit or having a baby. Which one do you need?");
    }
    const code = parsed.procedure_code as ProcedureCode;
    const payer = parsed.wants_cash || parsed.payer === "none" ? null : parsed.payer;
    // A named place is geocoded by OpenStreetMap, never by Claude.
    const geo = parsed.place ? await geocodePlace(parsed.place) : null;
    if (parsed.place && !geo) throw new Error(`I couldn't find "${parsed.place}" on the map. Try a city name or ZIP code.`);
    const placeName = geo?.label ?? null;
    const center: [number, number] = geo ? geo.center : lat != null && lon != null ? [lat, lon] : DEFAULT_CENTER;

    // 2. Agent Builder tools (same ones the OpenTab Advisor agent and MCP clients use).
    //    Search within ~25 miles; widen to ~60 miles if fewer than 2 hospitals have a price.
    t0 = Date.now();
    const compare = (maxKm: number) =>
      runTool("opentab.compare_procedure", {
        code,
        payer: payer ?? "",
        plan_type: payer ? parsed.plan_type : "any",
        near: `POINT(${center[1]} ${center[0]})`,
        max_km: maxKm,
      });
    const [first, allHospitals] = await Promise.all([compare(40), esql("FROM opentab-hospitals | KEEP hospital_id, hospital_name, location, payers | LIMIT 2000")]);
    let rows = first;
    let radiusKm = 40;
    const pricedCount = (rs: Row[]) => rs.filter((r) => (payer ? r.plan_rate_median : r.cash_price) != null).length;
    if (pricedCount(rows) < 2) {
      rows = await compare(100);
      radiusKm = 100;
    }
    t.tools = Date.now() - t0;

    const loc = new Map(allHospitals.map((h) => [String(h.hospital_id), parsePoint(h.location)]));
    const insurersOf = new Map(
      allHospitals.map((h) => {
        const p = h.payers as unknown;
        const list = (Array.isArray(p) ? p : p ? [p] : []).map((x) => cleanInsurer(String(x))).filter((x) => x && !/^(medicare|medi-cal)$/i.test(x));
        return [String(h.hospital_id), [...new Set(list)].sort()];
      }),
    );
    let hospitals: HospitalResult[] = rows.map((r) => {
      const planRate = num(r.plan_rate_median);
      const cash = num(r.cash_price);
      const price = payer ? planRate : cash;
      const p = loc.get(String(r.hospital_id));
      return {
        hospitalId: String(r.hospital_id),
        name: String(r.hospital_name),
        lat: p?.[0] ?? null,
        lon: p?.[1] ?? null,
        distanceKm: num(r.distance_km),
        planRate,
        planRateMin: num(r.plan_rate_min),
        planRateMax: num(r.plan_rate_max),
        cashPrice: cash,
        grossCharge: num(r.gross_charge),
        price,
        priceKind: price == null ? "none" : payer ? "plan" : "cash",
        savingsVsMax: null,
        cashBeatsPlan: planRate != null && cash != null && cash < planRate,
        fileLastUpdated: r.file_last_updated ? String(r.file_last_updated).slice(0, 10) : null,
        partial: num(r.partial) === 1,
        sourceUrl: r.source_url ? String(r.source_url) : null,
        insurers: insurersOf.get(String(r.hospital_id)) ?? [],
        hasYourInsurer: payer ? (insurersOf.get(String(r.hospital_id)) ?? []).includes(payer) : null,
      };
    });
    // Rank: published price first (ascending), then distance.
    hospitals.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    const priced = hospitals.filter((h) => h.price != null);
    const cheapest = priced.length ? priced[0].price : null;
    const mostExpensive = priced.length ? priced[priced.length - 1].price : null;
    hospitals = hospitals.map((h) => ({ ...h, savingsVsMax: h.price != null && mostExpensive != null ? mostExpensive - h.price : null }));
    const spread = cheapest != null && mostExpensive != null && priced.length > 1 ? mostExpensive - cheapest : null;

    const withCode = new Set(hospitals.map((h) => h.hospitalId));
    const notPublished = allHospitals
      .filter((h) => !withCode.has(String(h.hospital_id)))
      .flatMap((h) => {
        const p = parsePoint(h.location);
        if (!p || kmBetween(center, p) > radiusKm) return [];
        return [{ hospitalId: String(h.hospital_id), name: String(h.hospital_name), lat: p[0], lon: p[1] }];
      });

    // 3. Claude: two-sentence spoken summary, number-checked against what we computed.
    const label = PROCEDURES[code].label;
    const planLabel = payer ? `${payer} (${PLAN_TYPE_LABEL[parsed.plan_type] ?? "any plan"})` : "cash / self-pay";
    const top = priced.slice(0, 3);
    const most = priced[priced.length - 1];
    const fallback = !priced.length
      ? `None of the hospitals within ${Math.round(radiusKm * 0.621)} miles that I have published a ${payer ? `${payer} rate` : "cash price"} for a ${label.toLowerCase()}. ${hospitals.length ? "Check the cards for cash prices and source files." : "Try another procedure."}`
      : `The lowest published ${payer ? `${payer} rate` : "cash price"} for a ${label.toLowerCase()} is ${money(top[0].price!)} at ${top[0].name}.` +
        (spread ? ` Prices run up to ${money(mostExpensive!)}, so you could save ${money(spread)} by choosing carefully.` : "");
    const facts = [
      `Procedure: ${PROCEDURES[code].long}. Person's coverage: ${planLabel}.`,
      priced.length
        ? `Cheapest: ${top.map((h) => `${h.name} ${money(h.price!)}`).join("; ")}. Most expensive: ${most.name} ${money(most.price!)}. Spread: ${spread ? money(spread) : "n/a"}.`
        : `No hospital published a dollar amount for this coverage.`,
      `${hospitals.filter((h) => h.price == null).length} hospitals did not publish this for their plan.`,
      hospitals.some((h) => h.cashBeatsPlan) && payer ? `At some hospitals the cash price is lower than the ${payer} rate.` : "",
    ].join("\n");
    const allowed = [...priced.map((h) => h.price!), ...(spread ? [spread] : [])].map((n) => Math.round(n));
    t0 = Date.now();
    const { summary, checked } = await summarize({ text: facts, allowed: [...allowed, ...priced.map((h) => h.price!)], fallback });
    t.summary = Date.now() - t0;

    await ctx.runMutation(internal.searches.record, {
      procedureCode: code,
      procedureLabel: label,
      payer: payer ?? undefined,
      planType: payer ? parsed.plan_type : undefined,
      hospitals: priced.length,
    });

    return {
      procedureCode: code,
      procedureLabel: label,
      procedureNote: parsed.procedure_note,
      payer,
      planType: payer ? parsed.plan_type : "any",
      planLabel,
      center,
      placeName,
      radiusKm,
      widened: radiusKm > 40,
      hospitals,
      notPublished,
      cheapest,
      mostExpensive,
      spread,
      summary,
      summaryChecked: checked,
      timings: t,
    };
  },
});

/** Display cleanup for insurer names from price files: drop plan codes like "[1177113]" and fix common short forms. */
function cleanInsurer(raw: string): string {
  const s = raw.replace(/\s*\[[^\]]*\]/g, "").replace(/\s*\(\d+\)/g, "").replace(/\s+/g, " ").trim();
  if (/^united$|^uhc$/i.test(s)) return "UnitedHealthcare";
  if (/brown\s*(&|and)\s*tolan/i.test(s)) return "Brown & Toland";
  return s;
}

/** Elastic returns geo_point in ES|QL as "POINT (lon lat)". */
function parsePoint(v: Row[string]): [number, number] | null {
  const m = typeof v === "string" ? v.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i) : null;
  return m ? [Number(m[2]), Number(m[1])] : null;
}
