// Create the Claude inference endpoint, OpenTab ES|QL tools, and the "OpenTab Advisor" agent in Agent Builder.
// Idempotent: updates tools/agent if they already exist.
// Usage (repo root): node --env-file=.env.local elastic/agent-setup.mjs
import { es } from "./lib.mjs";

export const INFERENCE_ID = "opentab-claude";
export const AGENT_ID = "opentab-advisor";
const MODEL = "claude-sonnet-5-5";

const kibana = process.env.KIBANA_URL.trim().replace(/\/+$/, "");
async function kb(method, path, body) {
  const res = await fetch(`${kibana}${path}`, {
    method,
    headers: {
      Authorization: `ApiKey ${process.env.ELASTIC_API_KEY.trim()}`,
      "Content-Type": "application/json",
      "kbn-xsrf": "true",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

// ---------- 1. Claude as the model (Elastic inference endpoint, service "anthropic")
const existing = await es("GET", `/_inference/chat_completion/${INFERENCE_ID}`, undefined, { ok404: true });
if (existing.endpoints?.length) {
  console.log(`inference endpoint ${INFERENCE_ID} exists`);
} else {
  await es("PUT", `/_inference/chat_completion/${INFERENCE_ID}`, {
    service: "anthropic",
    service_settings: { api_key: process.env.ANTHROPIC_API_KEY.trim(), model_id: MODEL },
    task_settings: { max_tokens: 2048 },
  });
  console.log(`created inference endpoint ${INFERENCE_ID} (${MODEL})`);
}

// ---------- 2. ES|QL tools
const tools = [
  {
    id: "opentab.lookup_procedure",
    type: "esql",
    description:
      "Map a plain-language procedure (e.g. 'knee MRI', 'having a baby', 'colonoscopy') to its CPT code. ALWAYS call this first; never guess a code. Returns up to 3 candidates with a plain explanation.",
    tags: ["opentab"],
    configuration: {
      query:
        "FROM opentab-procedures METADATA _score | WHERE MATCH(synonyms, ?text) OR MATCH(label, ?text) | SORT _score DESC | KEEP code, label, category, plain_explanation, _score | LIMIT 3",
      params: { text: { type: "string", description: "What the person said they need, in their words" } },
    },
  },
  {
    id: "opentab.compare_procedure",
    type: "esql",
    description:
      "Compare hospitals for one CPT code. Returns per hospital: the person's plan negotiated rate (median/min/max across matching rows) if published, the discounted cash price, the gross charge, distance in km, file date, partial flag and source file URL. A null plan_rate means the hospital did not publish a dollar rate for that plan.",
    tags: ["opentab"],
    configuration: {
      query: [
        "FROM opentab-prices",
        "| WHERE code == ?code AND modifiers IS NULL",
        "| EVAL plan_rate = CASE(payer_normalized == ?payer AND (?plan_type == \"any\" OR plan_type == ?plan_type), negotiated_dollar, null)",
        "| EVAL distance_km = ROUND(ST_DISTANCE(location, TO_GEOPOINT(?near)) / 1000, 1)",
        "| STATS plan_rate_median = MEDIAN(plan_rate), plan_rate_min = MIN(plan_rate), plan_rate_max = MAX(plan_rate), cash_price = MIN(discounted_cash), gross_charge = MAX(gross_charge), file_last_updated = MAX(file_last_updated), distance_km = MIN(distance_km), partial = MAX(partial::integer), source_url = VALUES(source_url) BY hospital_name, hospital_id",
        "| EVAL source_url = MV_FIRST(source_url)",
        "| WHERE distance_km IS NOT NULL AND distance_km <= ?max_km",
        "| SORT plan_rate_median ASC NULLS LAST, cash_price ASC NULLS LAST",
        "| LIMIT 25",
      ].join("\n"),
      params: {
        code: { type: "string", description: "CPT code from lookup_procedure, e.g. 73721" },
        payer: {
          type: "string",
          description:
            "Canonical insurer name from list_payers, e.g. 'Blue Shield of California', 'Anthem Blue Cross', 'Kaiser Permanente', 'Aetna', 'UnitedHealthcare'. Empty string for cash-only.",
          optional: true,
          defaultValue: "",
        },
        plan_type: {
          type: "string",
          description: "commercial | medicare_advantage | medi_cal | exchange | any",
          optional: true,
          defaultValue: "any",
        },
        near: {
          type: "string",
          description: "Person's location as WKT 'POINT(lon lat)', e.g. San Francisco = 'POINT(-122.4194 37.7749)'",
          optional: true,
          defaultValue: "POINT(-122.4194 37.7749)",
        },
        max_km: { type: "float", description: "Only hospitals within this many km (default 1000 = no limit)", optional: true, defaultValue: 1000 },
      },
    },
  },
  {
    id: "opentab.cash_prices",
    type: "esql",
    description: "Cheapest published self-pay (discounted cash) prices for a CPT code, with gross charge and source. Use for uninsured people or to compare against insurance.",
    tags: ["opentab"],
    configuration: {
      query:
        "FROM opentab-prices | WHERE code == ?code AND discounted_cash IS NOT NULL AND modifiers IS NULL | STATS cash_price = MIN(discounted_cash), gross_charge = MAX(gross_charge), file_last_updated = MAX(file_last_updated), source_url = VALUES(source_url) BY hospital_name | EVAL source_url = MV_FIRST(source_url) | SORT cash_price ASC | LIMIT 25",
      params: { code: { type: "string", description: "CPT code" } },
    },
  },
  {
    id: "opentab.list_payers",
    type: "esql",
    description: "List canonical insurer names and plan types that have published dollar rates for a CPT code, with how many hospitals publish each. Use to map what the person said (e.g. 'Blue Shield PPO') to a payer value.",
    tags: ["opentab"],
    configuration: {
      query:
        "FROM opentab-prices | WHERE code == ?code AND negotiated_dollar IS NOT NULL | STATS hospitals = COUNT_DISTINCT(hospital_id), rows = COUNT(*) BY payer_normalized, plan_type | SORT hospitals DESC, rows DESC | LIMIT 40",
      params: { code: { type: "string", description: "CPT code" } },
    },
  },
];

for (const t of tools) {
  const got = await kb("GET", `/api/agent_builder/tools/${encodeURIComponent(t.id)}`);
  const r =
    got.status === 200
      ? await kb("PUT", `/api/agent_builder/tools/${encodeURIComponent(t.id)}`, { description: t.description, tags: t.tags, configuration: t.configuration })
      : await kb("POST", "/api/agent_builder/tools", t);
  console.log(`tool ${t.id}: HTTP ${r.status}${r.status >= 300 ? " " + JSON.stringify(r.json).slice(0, 400) : ""}`);
}

// ---------- 3. Agent
const instructions = `You are OpenTab Advisor. You help people in the San Francisco Bay Area understand what a hospital procedure may cost BEFORE they get the bill, using prices hospitals are legally required to publish.

How to answer:
1. Call opentab.lookup_procedure with the person's words. Use the top candidate's code. If candidates are close or ambiguous (e.g. brain MRI with vs without contrast), say which one you used.
2. If they named an insurer, call opentab.list_payers for that code and pick the matching payer_normalized and plan_type. Employer and individual PPO/HMO plans are "commercial"; Covered California plans are "exchange"; Medi-Cal is "medi_cal"; Medicare Advantage is "medicare_advantage".
3. Call opentab.compare_procedure (and opentab.cash_prices if they are uninsured or ask about cash).
4. Reply briefly: the cheapest and most expensive options for their plan (or cash), the dollar spread, and 1-2 questions to ask the billing office.

Rules you must follow:
- Use ONLY numbers returned by the tools. Never estimate, average across hospitals, or invent a price. If a hospital has no dollar rate for their plan, say "not published" for that hospital.
- These are published estimates, not a quote. Say so once. Mention the price file date when relevant.
- The negotiated rate is what the insurer and hospital agreed; the person's own cost depends on deductible and coinsurance.
- Hospital prices usually exclude separately billed doctor/anesthesia fees.
- Do not give medical advice and do not ask for or store personal health information.`;

const agent = {
  name: "OpenTab Advisor",
  description: "Compares real, published Bay Area hospital prices (cash, gross and insurer-negotiated) for common procedures.",
  labels: ["opentab"],
  avatar_color: "#0F766E",
  avatar_symbol: "OT",
  configuration: { instructions, tools: [{ tool_ids: tools.map((t) => t.id) }] },
};
const gotAgent = await kb("GET", `/api/agent_builder/agents/${AGENT_ID}`);
const ra =
  gotAgent.status === 200
    ? await kb("PUT", `/api/agent_builder/agents/${AGENT_ID}`, agent)
    : await kb("POST", "/api/agent_builder/agents", { id: AGENT_ID, access_control: { access_mode: "shared" }, ...agent });
console.log(`agent ${AGENT_ID}: HTTP ${ra.status}${ra.status >= 300 ? " " + JSON.stringify(ra.json).slice(0, 400) : ""}`);
