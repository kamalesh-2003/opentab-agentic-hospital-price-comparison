// Claude calls for OpenTab: (1) turn a spoken/typed question into a structured search,
// (2) write a two-sentence spoken summary from numbers we computed. Claude never produces prices.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { PAYERS, PLAN_TYPES, PROCEDURE_CODES, PROCEDURES } from "./catalog";

const MODEL = "claude-opus-5-5";
// Refusal fallback: on a policy decline the API re-runs the request on a suitable model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() }));

export const ParsedQuestion = z.object({
  procedure_code: z.enum([...PROCEDURE_CODES, "none"]).describe('CPT code from the list, or "none" if the question is not about one of them'),
  procedure_note: z.string().describe("One short sentence on which version you picked if the question was ambiguous; empty otherwise"),
  payer: z.enum([...PAYERS, "none"]).describe('Insurer named by the person, or "none" if uninsured / not mentioned'),
  plan_type: z.enum(PLAN_TYPES).describe("Product line if stated or implied; any if unknown"),
  place: z.string().describe('US city, neighborhood or ZIP the person asked about, exactly as they said it (e.g. "Oakland", "Fresno, CA", "94110"); empty string to use their current location'),
  wants_cash: z.boolean().describe("True if uninsured, self-pay, or asking about cash price"),
});
export type ParsedQuestion = z.infer<typeof ParsedQuestion>;

const PARSE_SYSTEM = `You turn a person's question about hospital costs into a structured search for OpenTab, a US hospital price-comparison app.
Procedures you can choose from (CPT code: description):
${Object.entries(PROCEDURES)
  .map(([c, p]) => `${c}: ${p.long}`)
  .join("\n")}
Rules:
- Most people ask about imaging (MRI, CT, X-ray, ultrasound, mammogram). "Back MRI" = lower back (72148) unless they say neck. "CT of my belly" = 74177 with contrast unless they say no contrast / kidney stone (74176). "Mammogram" = screening (77067) unless they mention a lump or follow-up (77066).
- Choose the single closest procedure. "MRI of my knee" = 73721. "Having a baby" = 59400 unless they say C-section. Plain "brain MRI" = 70551.
- Plan type: insurance through a job or bought privately = commercial; Covered California = exchange; Medi-Cal / Medicaid = medi_cal; Medicare Advantage = medicare_advantage. "Kaiser through my job" = Kaiser Permanente + commercial.
- Only fill place if the person names one ("near Oakland", "in San Jose"). "Near me" or no place = empty string.
- The question may come from speech-to-text and contain errors; interpret generously.`;

export async function parseQuestion(question: string): Promise<ParsedQuestion> {
  const res = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(ParsedQuestion) },
    system: PARSE_SYSTEM,
    messages: [{ role: "user", content: question.slice(0, 600) }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    throw new Error("Could not understand that question. Try naming a procedure, like 'knee MRI'.");
  }
  return res.parsed_output;
}

/**
 * Two sentences for text-to-speech. Every dollar amount in the output must appear in `facts.allowed`;
 * if Claude mentions any other number, we fall back to a template (see README: "Where Claude can go wrong").
 */
export async function summarize(facts: { text: string; allowed: number[]; fallback: string }): Promise<{ summary: string; checked: boolean }> {
  try {
    const res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system:
        "You write the spoken answer for OpenTab, a hospital price app. Write exactly two short sentences a voice assistant will read aloud. Use only the dollar amounts given in the facts, written like $1,234. Name the cheapest option and the spread. No markdown, no lists, no medical advice. Do not say 'quote' or promise a price.",
      messages: [{ role: "user", content: facts.text }],
    });
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join(" ")
      .trim();
    if (res.stop_reason === "refusal" || !text) return { summary: facts.fallback, checked: false };
    const mentioned = [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const ok = mentioned.every((n) => facts.allowed.some((a) => Math.abs(a - n) < 1));
    return ok ? { summary: text, checked: true } : { summary: facts.fallback, checked: false };
  } catch {
    return { summary: facts.fallback, checked: false };
  }
}
