// Place name -> coordinates with OpenStreetMap Nominatim. Claude only extracts the place text;
// coordinates always come from a real geocoder (or our fixed Bay Area table), never from the model.
import { PLACES } from "./catalog";

export async function geocodePlace(place: string): Promise<{ center: [number, number]; label: string } | null> {
  const p = place.trim();
  if (!p) return null;
  const known = Object.keys(PLACES).find((k) => k.toLowerCase() === p.toLowerCase());
  if (known) return { center: PLACES[known], label: known };
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(p)}`, {
      headers: { "User-Agent": "OpenTab/0.1 (Cal Hacks hospital price comparison)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!j[0]) return null;
    return { center: [Number(j[0].lat), Number(j[0].lon)], label: j[0].display_name.split(",").slice(0, 2).join(",").trim() };
  } catch {
    return null;
  }
}

export function kmBetween(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
