export interface PriceRecord {
  hospital_id: string;
  hospital_name: string;
  hospital_location: string | null;
  address: string | null;
  location: { lat: number; lon: number } | null;
  hospital_domain: string | null;
  source_url: string;
  source_page_url: string | null;
  file_last_updated: string | null;
  file_version: string | null;
  ingested_at: string;
  partial: boolean;
  code: string;
  code_type: string;
  description: string | null;
  setting: string | null;
  modifiers: string | null;
  gross_charge: number | null;
  discounted_cash: number | null;
  payer_name: string | null;
  payer_normalized: string | null;
  plan_type: "commercial" | "medicare_advantage" | "medi_cal" | "exchange" | "other" | null;
  plan_name: string | null;
  negotiated_dollar: number | null;
  negotiated_percentage: number | null;
  negotiated_algorithm: string | null;
  methodology: string | null;
  median_amount: number | null;
  min_negotiated: number | null;
  max_negotiated: number | null;
}

/** Fields shared by every record from one price file. */
export interface FileContext {
  hospital_id: string;
  hospital_name: string;
  hospital_location: string | null;
  address: string | null;
  hospital_domain: string | null;
  source_url: string;
  source_page_url: string | null;
  file_last_updated: string | null;
  file_version: string | null;
  ingested_at: string;
}

/** One row of standard charges before it is joined with file context. */
export type ChargeRow = Omit<PriceRecord, keyof FileContext | "partial" | "location">;
