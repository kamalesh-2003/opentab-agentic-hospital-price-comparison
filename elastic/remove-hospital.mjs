// Remove a hospital's prices from Elastic (e.g. reset the live "add a hospital" demo after a rehearsal).
// Usage (repo root): node --env-file=.env.local elastic/remove-hospital.mjs "Salinas Valley"
import { es } from "./lib.mjs";

const phrase = process.argv.slice(2).join(" ").trim();
if (phrase.length < 4) throw new Error('Pass part of the hospital name, e.g. "Salinas Valley"');
for (const idx of ["opentab-prices", "opentab-hospitals"]) {
  const r = await es("POST", `/${idx}/_delete_by_query?refresh=true`, { query: { match_phrase: { hospital_name: phrase } } });
  console.log(`${idx}: deleted ${r.deleted}`);
}
