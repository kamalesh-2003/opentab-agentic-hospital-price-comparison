// Fixed vocabularies shared by the Convex backend and the UI.
// Claude must pick from these lists (enforced with structured outputs), so it cannot
// invent a procedure code, an insurer, or a map coordinate.

export const PROCEDURES = {
  "73721": { label: "Knee MRI", long: "MRI of the knee (no contrast)" },
  "70551": { label: "Brain MRI", long: "MRI of the brain (no contrast)" },
  "70553": { label: "Brain MRI with contrast", long: "MRI of the brain (with and without contrast)" },
  "74177": { label: "CT abdomen & pelvis", long: "CT scan of abdomen and pelvis (with contrast)" },
  "71046": { label: "Chest X-ray", long: "Chest X-ray (2 views)" },
  "76700": { label: "Abdominal ultrasound", long: "Abdominal ultrasound (complete)" },
  "77067": { label: "Mammogram", long: "Screening mammogram" },
  "45378": { label: "Colonoscopy", long: "Colonoscopy (diagnostic)" },
  "43239": { label: "Upper endoscopy", long: "Upper GI endoscopy with biopsy" },
  "66984": { label: "Cataract surgery", long: "Cataract surgery" },
  "27447": { label: "Knee replacement", long: "Total knee replacement" },
  "59400": { label: "Vaginal delivery", long: "Vaginal delivery (routine care)" },
  "59510": { label: "C-section", long: "C-section (routine care)" },
  "99203": { label: "New patient visit", long: "New patient office visit (30-44 min)" },
  "99213": { label: "Office visit", long: "Established patient office visit (20-29 min)" },
  "99283": { label: "ER visit (level 3)", long: "ER visit (moderate)" },
  "99284": { label: "ER visit (level 4)", long: "ER visit (moderately high)" },
  "99285": { label: "ER visit (level 5)", long: "ER visit (high severity)" },
  "85025": { label: "Blood count (CBC)", long: "Complete blood count (CBC)" },
  "80053": { label: "Metabolic panel", long: "Comprehensive metabolic panel (CMP)" },
  "80061": { label: "Cholesterol test", long: "Lipid panel" },
  "97161": { label: "PT evaluation", long: "Physical therapy evaluation" },
  "95810": { label: "Sleep study", long: "Sleep study (in lab)" },
  "72148": { label: "Lower back MRI", long: "MRI of the lumbar spine (no contrast)" },
  "72141": { label: "Neck MRI", long: "MRI of the cervical spine (no contrast)" },
  "73221": { label: "Shoulder MRI", long: "MRI of the shoulder or arm joint (no contrast)" },
  "70450": { label: "Head CT", long: "CT scan of the head (no contrast)" },
  "71250": { label: "Chest CT", long: "CT scan of the chest (no contrast)" },
  "74176": { label: "CT abdomen & pelvis (no contrast)", long: "CT scan of abdomen and pelvis (no contrast)" },
  "76856": { label: "Pelvic ultrasound", long: "Pelvic ultrasound (complete)" },
  "76805": { label: "Pregnancy ultrasound", long: "Obstetric ultrasound (after first trimester)" },
  "77066": { label: "Diagnostic mammogram", long: "Diagnostic mammogram (both breasts)" },
  "73030": { label: "Shoulder X-ray", long: "Shoulder X-ray (2+ views)" },
  "72100": { label: "Lower back X-ray", long: "Lumbar spine X-ray (2-3 views)" },
  "73562": { label: "Knee X-ray", long: "Knee X-ray (3 views)" },
  "78815": { label: "PET/CT scan", long: "PET/CT scan (skull base to mid-thigh)" },
  "93306": { label: "Echocardiogram", long: "Echocardiogram (complete, with Doppler)" },
  "77080": { label: "Bone density scan", long: "DEXA bone density scan" },
} as const;
export type ProcedureCode = keyof typeof PROCEDURES;
export const PROCEDURE_CODES = Object.keys(PROCEDURES) as [ProcedureCode, ...ProcedureCode[]];

// Must match payer_normalized values produced by the Actor (actor/src/payers.ts).
export const PAYERS = [
  "Blue Shield of California",
  "Anthem Blue Cross",
  "Kaiser Permanente",
  "Aetna",
  "Cigna",
  "UnitedHealthcare",
  "Health Net",
  "Humana",
  "Sutter Health Plus",
  "Western Health Advantage",
  "Brown & Toland",
  "Hill Physicians",
  "Chinese Community Health Plan",
  "Alameda Alliance for Health",
  "San Francisco Health Plan",
  "Santa Clara Family Health Plan",
  "Contra Costa Health Plan",
  "Partnership HealthPlan",
  "Oscar",
  "Molina",
  "Medicare",
  "Medi-Cal",
] as const;

export const PLAN_TYPES = ["commercial", "medicare_advantage", "medi_cal", "exchange", "any"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const PLAN_TYPE_LABEL: Record<string, string> = {
  commercial: "employer/individual plan",
  medicare_advantage: "Medicare Advantage",
  medi_cal: "Medi-Cal",
  exchange: "Covered California",
  any: "any plan",
};

/** Bay Area places Claude may move the map to. [lat, lon] of each town center. */
export const PLACES: Record<string, [number, number]> = {
  "San Francisco": [37.7749, -122.4194],
  Oakland: [37.8044, -122.2712],
  Berkeley: [37.8715, -122.273],
  Richmond: [37.9358, -122.3477],
  "Walnut Creek": [37.9101, -122.0652],
  Concord: [37.978, -122.0311],
  Hayward: [37.6688, -122.0808],
  "San Leandro": [37.7249, -122.1561],
  "Castro Valley": [37.6941, -122.0864],
  Fremont: [37.5485, -121.9886],
  Livermore: [37.6819, -121.768],
  Pleasanton: [37.6624, -121.8747],
  "Daly City": [37.6879, -122.4702],
  "South San Francisco": [37.6547, -122.4077],
  "San Mateo": [37.563, -122.3255],
  Burlingame: [37.5841, -122.3661],
  "Redwood City": [37.4852, -122.2364],
  "Palo Alto": [37.4419, -122.143],
  "Mountain View": [37.3861, -122.0839],
  Sunnyvale: [37.3688, -122.0363],
  "Santa Clara": [37.3541, -121.9552],
  "San Jose": [37.3382, -121.8863],
  "Los Gatos": [37.2358, -121.9624],
  "San Rafael": [37.9735, -122.5311],
  Greenbrae: [37.9485, -122.5247],
  Novato: [38.1074, -122.5697],
};
export const PLACE_NAMES = Object.keys(PLACES) as [string, ...string[]];

export const DEFAULT_CENTER: [number, number] = PLACES["San Francisco"];
