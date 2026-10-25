/** Default shoppable procedures (CPT). Description is our plain-language label. */
export const TARGET_CODES: Record<string, string> = {
  "73721": "MRI knee (no contrast)",
  "70551": "MRI brain (no contrast)",
  "70553": "MRI brain (with and without contrast)",
  "74177": "CT abdomen and pelvis (with contrast)",
  "45378": "Colonoscopy (diagnostic)",
  "43239": "Upper GI endoscopy with biopsy",
  "59400": "Vaginal delivery (routine care)",
  "59510": "C-section (routine care)",
  "27447": "Total knee replacement",
  "66984": "Cataract surgery",
  "99203": "New patient office visit (30-44 min)",
  "99213": "Established patient office visit (20-29 min)",
  "99283": "ER visit (moderate)",
  "99284": "ER visit (moderately high)",
  "99285": "ER visit (high severity)",
  "77067": "Screening mammogram",
  "71046": "Chest X-ray (2 views)",
  "76700": "Abdominal ultrasound (complete)",
  "85025": "Complete blood count (CBC)",
  "80053": "Comprehensive metabolic panel (CMP)",
  "80061": "Lipid panel",
  "97161": "Physical therapy evaluation",
  "95810": "Sleep study (in lab)",
};

export const PROCEDURE_CODE_TYPES = new Set(["CPT", "HCPCS"]);

export function normCode(c: unknown): string {
  return String(c ?? "").trim().toUpperCase();
}
