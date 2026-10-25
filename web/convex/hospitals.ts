"use node";
import { action } from "./_generated/server";
import { esql } from "./lib/elastic";

export type MapHospital = {
  hospitalId: string;
  name: string;
  lat: number;
  lon: number;
  fileLastUpdated: string | null;
  recordCount: number;
  partial: boolean;
};

/** All indexed hospitals with a map location (for the initial map). */
export const list = action({
  args: {},
  handler: async (): Promise<MapHospital[]> => {
    const rows = await esql(
      "FROM opentab-hospitals | WHERE location IS NOT NULL | KEEP hospital_id, hospital_name, location, file_last_updated, record_count, partial | LIMIT 500",
    );
    return rows.flatMap((r) => {
      const m = typeof r.location === "string" ? r.location.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i) : null;
      if (!m) return [];
      return [
        {
          hospitalId: String(r.hospital_id),
          name: String(r.hospital_name),
          lat: Number(m[2]),
          lon: Number(m[1]),
          fileLastUpdated: r.file_last_updated ? String(r.file_last_updated).slice(0, 10) : null,
          recordCount: Number(r.record_count ?? 0),
          partial: Boolean(r.partial),
        },
      ];
    });
  },
});
