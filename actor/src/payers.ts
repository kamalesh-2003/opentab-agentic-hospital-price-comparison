/** Map messy insurer names to one canonical insurer. First match wins; order matters. */
const INSURERS: [RegExp, string][] = [
  [/blue\s*shield|\bbsc\b/i, "Blue Shield of California"],
  [/anthem|blue\s*cross/i, "Anthem Blue Cross"],
  [/kaiser/i, "Kaiser Permanente"],
  [/aetna/i, "Aetna"],
  [/cigna/i, "Cigna"],
  [/united\s*health|\buhc\b|optum|united\s*healthcare|^united$/i, "UnitedHealthcare"],
  [/health\s*net/i, "Health Net"],
  [/humana/i, "Humana"],
  [/sutter\s*health\s*plus/i, "Sutter Health Plus"],
  [/western\s*health\s*advantage/i, "Western Health Advantage"],
  [/brown\s*(&|and)\s*toland?/i, "Brown & Toland"],
  [/hill\s*physicians/i, "Hill Physicians"],
  [/chinese\s*community/i, "Chinese Community Health Plan"],
  [/alameda\s*alliance/i, "Alameda Alliance for Health"],
  [/san\s*francisco\s*health\s*plan|\bsfhp\b/i, "San Francisco Health Plan"],
  [/santa\s*clara\s*family/i, "Santa Clara Family Health Plan"],
  [/contra\s*costa\s*health\s*plan|\bcchp\b/i, "Contra Costa Health Plan"],
  [/partnership\s*health/i, "Partnership HealthPlan"],
  [/multiplan/i, "MultiPlan"],
  [/first\s*health/i, "First Health"],
  [/oscar/i, "Oscar"],
  [/molina/i, "Molina"],
  [/tricare/i, "TRICARE"],
  [/aspire/i, "Aspire Health Plan"],
  [/\bmedicare\b/i, "Medicare"],
  [/medi-?cal/i, "Medi-Cal"],
];

export function normalizePayer(payer: string | null): string | null {
  if (!payer) return null;
  // Strip plan/contract codes some files append, e.g. "CIGNA HMO [1010103]".
  payer = payer.replace(/\s*\[[^\]]*\]/g, "").replace(/\s*\(\d+\)/g, "").trim();
  if (!payer) return null;
  for (const [re, name] of INSURERS) if (re.test(payer)) return name;
  return payer
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type PlanType = "commercial" | "medicare_advantage" | "medi_cal" | "exchange" | "other";

/** Classify the product line from payer + plan text. A Blue Shield Medicare plan is medicare_advantage, not commercial. */
export function planType(payer: string | null, plan: string | null): PlanType | null {
  if (!payer && !plan) return null;
  const t = `${payer ?? ""} ${plan ?? ""}`;
  // Files abbreviate heavily: "MCR ADV", "MCARE", "M-CAL", "MCAL", "MA HMO", "DSNP".
  if (/\bcommercial\b/i.test(t) && !/medicare|\bmcare\b|\bmcr\b|medi-?cal|medicaid/i.test(t)) return "commercial";
  if (/medi-?cal|\bm-?cal\b|medicaid|alliance|family\s*health\s*plan|san\s*francisco\s*health\s*plan|partnership/i.test(t)) return "medi_cal";
  if (/medicare|advantage|\bmcare\b|\bmcr\b|\bmedi\s*adv|\badv\b|\bmapd?\b|\bma\s*(hmo|ppo)\b|\bd-?snp\b|senior/i.test(t)) return "medicare_advantage";
  if (/covered\s*california|exchange|marketplace|\bifp\b/i.test(t)) return "exchange";
  if (/workers?'?\s*comp|auto|tricare|va\b|veteran/i.test(t)) return "other";
  return "commercial";
}
