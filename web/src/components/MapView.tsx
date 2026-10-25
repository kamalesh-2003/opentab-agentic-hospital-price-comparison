"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type Pin = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Text on the pin, e.g. "$1,949" or "n/p". */
  label: string | null;
  tone: "low" | "mid" | "high" | "none" | "idle" | "new";
  selected?: boolean;
};

type Props = {
  center: [number, number];
  user: [number, number] | null;
  pins: Pin[];
  /** Change this value to re-fit the map to the priced pins. */
  fitKey: string;
  onSelect: (id: string) => void;
};

/** Full-screen Leaflet map with price-tag pins. CARTO light tiles (free, no key). */
export default function MapView({ center, user, pins, fitKey, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const userLayer = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(center, 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(m);
    L.control.zoom({ position: "topright" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    userLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const p of pins) {
      const html = p.label
        ? `<div class="ot-pin ot-${p.tone}${p.selected ? " ot-selected" : ""}"><span>${escapeHtml(p.label)}</span></div>`
        : `<div class="ot-dot ot-${p.tone}${p.selected ? " ot-selected" : ""}"></div>`;
      const icon = L.divIcon({ html, className: "ot-icon", iconSize: [0, 0] });
      L.marker([p.lat, p.lon], { icon, title: p.name, riseOnHover: true, zIndexOffset: p.selected ? 1000 : p.tone === "low" ? 500 : 0 })
        .on("click", () => onSelectRef.current(p.id))
        .bindTooltip(escapeHtml(p.name), { direction: "top", offset: [0, -18] })
        .addTo(g);
    }
  }, [pins]);

  // User location
  useEffect(() => {
    const g = userLayer.current;
    if (!g) return;
    g.clearLayers();
    if (user) {
      L.circleMarker(user, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(g);
      L.circle(user, { radius: 600, color: "#2563eb", weight: 0, fillOpacity: 0.12 }).addTo(g);
    }
  }, [user]);

  // Re-center / fit when a new search comes back
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const priced = pins.filter((p) => p.label && p.tone !== "none");
    if (priced.length >= 2) {
      const pts = priced.slice(0, 8).map((p) => [p.lat, p.lon] as [number, number]);
      pts.push(center);
      m.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 12, duration: 0.8 });
    } else {
      m.flyTo(center, 11, { duration: 0.8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={el} className="absolute inset-0 z-0" aria-label="Map of hospitals" role="region" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
