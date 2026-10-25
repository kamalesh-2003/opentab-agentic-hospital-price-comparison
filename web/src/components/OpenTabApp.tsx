"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AskResult, HospitalResult } from "../../convex/ask";
import type { MapHospital } from "../../convex/hospitals";
import { DEFAULT_CENTER } from "../../convex/lib/catalog";
import type { Pin } from "./MapView";
import { useVoice } from "./useVoice";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const EXAMPLES = [
  "How much is a knee MRI with Blue Shield?",
  "Cheapest lower back MRI if I pay cash",
  "CT scan of my belly, I have Aetna",
  "Mammogram near Oakland with Anthem",
];

/** Radius for discovering and comparing hospitals (~25 miles). */
const SCAN_KM = 40;

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export default function OpenTabApp() {
  const listHospitals = useAction(api.hospitals.list);
  const askAction = useAction(api.ask.ask);
  const scanAction = useAction(api.nearbyScan.scan);
  const lastAsk = useRef(0);

  const [hospitals, setHospitals] = useState<MapHospital[]>([]);
  const [user, setUser] = useState<[number, number] | null>(null);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newIds, setNewIds] = useState<string[]>([]);

  const refreshHospitals = useCallback(() => listHospitals({}).then(setHospitals).catch(() => {}), [listHospitals]);
  useEffect(() => {
    refreshHospitals();
  }, [refreshHospitals]);

  // Ask for location once; fall back to San Francisco.
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setUser([p.coords.latitude, p.coords.longitude]),
      () => {},
      { timeout: 8000, maximumAge: 600_000 },
    );
  }, []);

  const center = result?.center ?? user ?? DEFAULT_CENTER;

  // "Any location": discover hospitals around the current center and pull their price files live.
  const scanned = useRef(new Set<string>());
  const [scanError, setScanError] = useState<string | null>(null);
  useEffect(() => {
    const tile = `${Math.round(center[0] * 5) / 5},${Math.round(center[1] * 5) / 5}`;
    if (scanned.current.has(tile)) return;
    scanned.current.add(tile);
    scanAction({ lat: center[0], lon: center[1], radiusKm: SCAN_KM })
      .then(() => setScanError(null))
      .catch((e) => setScanError(cleanError(e)));
  }, [center, scanAction]);
  const area = useQuery(api.nearby.inArea, { lat: center[0], lon: center[1], radiusKm: SCAN_KM });
  const reading = (area ?? []).filter((r) => r.status === "ingesting");
  const queuedCount = (area ?? []).filter((r) => r.status === "new").length;
  const indexedCount = (area ?? []).filter((r) => r.status === "indexed").length;

  const ask = useCallback(
    async (q: string, silent = false): Promise<AskResult | null> => {
      const text = q.trim();
      if (!text || loading) return null;
      lastAsk.current = Date.now();
      setAsked(text);
      if (!silent) {
        setLoading(true);
        setSelected(null);
      }
      setError(null);
      try {
        const r = await askAction({ question: text, lat: user?.[0], lon: user?.[1] });
        setResult(r);
        setSheetOpen(true);
        return r;
      } catch (e) {
        if (!silent) setError(cleanError(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [askAction, loading, user],
  );

  // Voice: tap the mic, speak, and OpenTab answers out loud (Cartesia STT + TTS).
  const voice = useVoice();
  const onMic = useCallback(async () => {
    if (voice.state === "listening" || voice.state === "finishing") return voice.stopListening();
    if (voice.state === "speaking") voice.stopSpeaking();
    voice.unlockAudio(); // must run inside the tap, before any await, or phones block the spoken answer
    const heard = await voice.listen();
    if (!heard) return;
    setQuestion(heard);
    const r = await ask(heard);
    if (r) voice.speak(r.summary);
    else voice.speak("Sorry, I couldn't find prices for that. Try naming a procedure, like a knee MRI.");
  }, [voice, ask]);

  // When a nearby hospital finishes ingesting, refresh the map and the current answer.
  const lastIndexed = useRef<number | null>(null);
  useEffect(() => {
    if (lastIndexed.current != null && indexedCount > lastIndexed.current) {
      refreshHospitals();
      if (asked && !loading && Date.now() - lastAsk.current > 12_000) ask(asked, true);
    }
    lastIndexed.current = indexedCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexedCount]);

  const discoveredPins: Pin[] = useMemo(
    () =>
      (area ?? [])
        .filter((r) => r.status !== "indexed")
        .map((r) => ({
          id: `nearby:${r._id}`,
          name: r.status === "ingesting" ? `${r.name}: reading its price file` : r.status === "new" ? `${r.name}: queued` : `${r.name}: ${r.detail ?? "no usable price file"}`,
          lat: r.lat,
          lon: r.lon,
          label: r.status === "ingesting" ? "reading…" : null,
          tone: r.status === "ingesting" ? ("loading" as const) : r.status === "new" ? ("queued" as const) : ("nodata" as const),
        })),
    [area],
  );

  const pins: Pin[] = useMemo(() => {
    if (!result) {
      return [
        ...discoveredPins,
        ...hospitals.map((h) => ({ id: h.hospitalId, name: h.name, lat: h.lat, lon: h.lon, label: null, tone: newIds.includes(h.hospitalId) ? ("new" as const) : ("idle" as const) })),
      ];
    }
    const priced = result.hospitals.filter((h) => h.price != null);
    const tone = (h: HospitalResult): Pin["tone"] => {
      if (h.price == null || result.cheapest == null || result.mostExpensive == null) return "none";
      const span = result.mostExpensive - result.cheapest || 1;
      const f = (h.price - result.cheapest) / span;
      return f < 0.34 ? "low" : f < 0.67 ? "mid" : "high";
    };
    const out: Pin[] = [];
    for (const h of result.hospitals) {
      if (h.lat == null || h.lon == null) continue;
      out.push({ id: h.hospitalId, name: h.name, lat: h.lat, lon: h.lon, label: h.price != null ? money(h.price) : "n/p", tone: tone(h), selected: selected === h.hospitalId });
    }
    for (const h of result.notPublished) {
      if (h.lat == null || h.lon == null) continue;
      out.push({ id: h.hospitalId, name: h.name, lat: h.lat, lon: h.lon, label: "n/p", tone: "none", selected: selected === h.hospitalId });
    }
    void priced;
    return [...discoveredPins, ...out];
  }, [hospitals, result, selected, newIds, discoveredPins]);

  const fitKey = `${result?.procedureCode ?? ""}|${result?.payer ?? ""}|${center.join(",")}|${hospitals.length}`;

  const onSelect = useCallback((id: string) => {
    if (id.startsWith("nearby:")) return;
    setSelected(id);
    setSheetOpen(true);
    requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <MapView center={center} user={user} pins={pins} fitKey={fitKey} onSelect={onSelect} />

      {/* Top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 sm:p-4">
        <div className="pointer-events-auto rounded-2xl bg-[var(--panel)] px-4 py-2 shadow-lg ring-1 ring-black/5">
          <h1 className="text-lg font-bold leading-tight text-[var(--brand)]">OpenTab</h1>
          <p className="text-xs text-[var(--muted)]">Know the bill before you get the bill.</p>
        </div>
        <div className="pointer-events-auto mr-12 flex flex-col items-end gap-2">
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="rounded-full bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--brand)] shadow-lg ring-1 ring-black/5 hover:bg-[var(--brand-soft)]"
          >
            + Add a hospital
          </button>
          {showAdd && (
            <AddHospital
              onDone={(ids) => {
                setNewIds(ids);
                refreshHospitals();
                if (asked) ask(asked);
              }}
              onClose={() => setShowAdd(false)}
            />
          )}
        </div>
      </header>

      {/* Live discovery status */}
      <div className="pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 md:left-auto md:right-16 md:top-4 md:translate-x-0">
        {(reading.length > 0 || scanError || area) && (
          <p className="pointer-events-auto rounded-full bg-[var(--panel)] px-4 py-2 text-xs font-medium shadow-lg ring-1 ring-black/5" role="status">
            {scanError ? (
              <span className="text-[var(--warn)]">Could not look up nearby hospitals: {scanError}</span>
            ) : reading.length > 0 ? (
              <>
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#7c3aed]" />
                Reading price files for {reading.length} nearby hospital{reading.length > 1 ? "s" : ""}
                {queuedCount ? ` (+${queuedCount} queued)` : ""}…
              </>
            ) : (
              <>
                {indexedCount} hospitals with prices within {Math.round(SCAN_KM * 0.621)} mi
              </>
            )}
          </p>
        )}
      </div>

      {/* Results sheet: bottom on phones, left column on desktop */}
      <section
        className={`absolute inset-x-0 bottom-0 z-10 flex max-h-[62dvh] flex-col rounded-t-3xl bg-[var(--panel)] shadow-2xl ring-1 ring-black/5 transition-transform md:inset-x-auto md:bottom-4 md:left-4 md:top-24 md:max-h-none md:w-[420px] md:rounded-3xl ${
          sheetOpen ? "" : "translate-y-[calc(100%-9.5rem)] md:translate-y-0"
        }`}
        aria-live="polite"
      >
        <button className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-black/15 md:hidden" aria-label={sheetOpen ? "Collapse results" : "Expand results"} onClick={() => setSheetOpen((o) => !o)} />
        <div className="flex-1 overflow-y-auto px-4 pb-40 pt-3 md:pb-6">
          <Results
            asked={asked}
            loading={loading}
            error={error}
            result={result}
            selected={selected}
            onSelect={onSelect}
            onExample={(q) => {
              setQuestion(q);
              ask(q);
            }}
            onSpeak={(t) => {
              if (voice.state === "speaking") return voice.stopSpeaking();
              voice.unlockAudio();
              voice.speak(t);
            }}
            speaking={voice.state === "speaking"}
          />
        </div>
      </section>

      {/* Listening overlay: the voice agent lives on the map */}
      {(voice.state === "connecting" || voice.state === "listening" || voice.state === "finishing") && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" aria-live="assertive">
          <div className="flex flex-col items-center gap-3">
            <span className="relative flex h-24 w-24 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--brand)] opacity-30" />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-2xl">
                <MicIcon className="h-8 w-8" />
              </span>
            </span>
            <p className="max-w-[80vw] rounded-2xl bg-[var(--panel)] px-4 py-2 text-center text-base shadow-xl ring-1 ring-black/5">
              {voice.transcript || (voice.state === "connecting" ? "Starting microphone…" : "Listening… ask about a procedure and your insurance")}
            </p>
          </div>
        </div>
      )}
      {voice.error && voice.state !== "listening" && (
        <p className="absolute inset-x-0 bottom-24 z-30 mx-auto w-fit max-w-[90vw] rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)] shadow md:bottom-24">{voice.error}</p>
      )}

      {/* Ask bar */}
      <form
        className="absolute inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:bottom-4 md:left-[440px] md:right-4 md:mx-0 md:max-w-none md:p-0"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <button
          type="button"
          onClick={onMic}
          aria-label={voice.state === "listening" ? "Stop listening" : "Ask by voice"}
          aria-pressed={voice.state === "listening"}
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white shadow-xl transition ${
            voice.state === "listening" || voice.state === "finishing" ? "scale-110 bg-[#b91c1c]" : "bg-[var(--brand)] hover:scale-105"
          }`}
        >
          {voice.state === "listening" || voice.state === "finishing" ? <span className="h-5 w-5 rounded-sm bg-white" /> : <MicIcon className="h-7 w-7" />}
        </button>
        <label htmlFor="q" className="sr-only">
          Ask about a procedure
        </label>
        <input
          id="q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask: knee MRI with Blue Shield, or cash price for a CT…"
          className="h-14 flex-1 rounded-full bg-[var(--panel)] px-5 text-base shadow-xl ring-1 ring-black/10 outline-none focus:ring-2 focus:ring-[var(--brand)]"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="h-14 rounded-full bg-[var(--brand)] px-5 font-semibold text-white shadow-xl disabled:opacity-50"
        >
          {loading ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}

function Results({
  asked,
  loading,
  error,
  result,
  selected,
  onSelect,
  onExample,
  onSpeak,
  speaking,
}: {
  asked: string | null;
  loading: boolean;
  error: string | null;
  result: AskResult | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onExample: (q: string) => void;
  onSpeak: (text: string) => void;
  speaking: boolean;
}) {
  const recent = useQuery(api.searches.recent);
  const [myInsurerOnly, setMyInsurerOnly] = useState(false);
  if (!asked && !result) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">What will your scan cost?</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            MRI, CT, X-ray and ultrasound prices vary wildly between hospitals, and sometimes paying cash beats your insurance. Hospitals must publish their real prices. Tap the mic and ask, and OpenTab compares what hospitals near you published, with a link to the source file for every number.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button key={q} onClick={() => onExample(q)} className="rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-left text-sm text-[var(--brand-strong)] hover:ring-1 hover:ring-[var(--brand)]">
              {q}
            </button>
          ))}
        </div>
        {recent && recent.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Recent searches</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {recent.map((r) => (
                <button key={r._id} onClick={() => onExample(`${r.procedureLabel}${r.payer ? ` with ${r.payer}` : " cash price"}`)} className="rounded-full px-3 py-1 text-xs ring-1 ring-black/10 hover:bg-black/5">
                  {r.procedureLabel}
                  {r.payer ? ` · ${r.payer}` : " · cash"}
                </button>
              ))}
            </div>
          </div>
        )}
        <Disclaimer />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {asked && <p className="text-sm italic text-[var(--muted)]">“{asked}”</p>}
      {loading && <LoadingState />}
      {error && !loading && <p className="rounded-xl bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">{error}</p>}
      {result && !loading && (
        <>
          <div className="rounded-2xl bg-[var(--brand-soft)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-strong)]">
              {result.procedureLabel} · {result.planLabel}
              {result.placeName ? ` · near ${result.placeName}` : ""} · within {Math.round(result.radiusKm * 0.621)} mi
            </p>
            {result.widened && (
              <p className="mt-1 text-xs text-[var(--muted)]">Few nearby hospitals published this, so the search was widened to {Math.round(result.radiusKm * 0.621)} miles.</p>
            )}
            <p className="mt-1 text-base leading-snug">{result.summary}</p>
            {result.spread != null && (
              <p className="mt-2 text-sm font-semibold text-[var(--good)]">You could save up to {money(result.spread)} by choosing the cheapest option.</p>
            )}
            {result.procedureNote && <p className="mt-2 text-xs text-[var(--muted)]">{result.procedureNote}</p>}
            <button onClick={() => onSpeak(result.summary)} className="mt-2 text-xs font-semibold text-[var(--brand-strong)] underline underline-offset-2">
              {speaking ? "■ Stop" : "🔊 Read aloud"}
            </button>
          </div>
          <PriceChart result={result} onSelect={onSelect} />
          {result.payer && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={myInsurerOnly} onChange={(e) => setMyInsurerOnly(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
              Only hospitals with published {result.payer} rates ({result.hospitals.filter((h) => h.hasYourInsurer).length})
            </label>
          )}
          <ol className="space-y-3">
            {result.hospitals.filter((h) => !myInsurerOnly || h.hasYourInsurer).map((h, i) => (
              <HospitalCard key={h.hospitalId} h={h} rank={h.price != null ? i + 1 : null} result={result} selected={selected === h.hospitalId} onSelect={onSelect} />
            ))}
          </ol>
          {result.notPublished.length > 0 && (
            <p className="text-xs text-[var(--muted)]">
              Not published for this procedure: {result.notPublished.map((h) => h.name).join(", ")}.
            </p>
          )}
          <Disclaimer />
        </>
      )}
    </div>
  );
}

function PriceChart({ result, onSelect }: { result: AskResult; onSelect: (id: string) => void }) {
  const priced = result.hospitals.filter((h) => h.price != null).slice(0, 8);
  if (priced.length < 2 || result.mostExpensive == null) return null;
  return (
    <figure className="rounded-2xl p-3 ring-1 ring-black/10">
      <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{result.payer ? `${result.payer} rate` : "Cash price"} by hospital</figcaption>
      <div className="space-y-1.5">
        {priced.map((h) => (
          <button key={h.hospitalId} onClick={() => onSelect(h.hospitalId)} className="flex w-full items-center gap-2 text-left text-xs">
            <span className="w-28 shrink-0 truncate" title={h.name}>
              {h.name}
            </span>
            <span className="relative h-4 flex-1 rounded bg-black/5">
              <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(3, (h.price! / result.mostExpensive!) * 100)}%`, background: h.price === result.cheapest ? "var(--good)" : "var(--bar)" }} />
            </span>
            <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{money(h.price)}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}

function HospitalCard({ h, rank, result, selected, onSelect }: { h: HospitalResult; rank: number | null; result: AskResult; selected: boolean; onSelect: (id: string) => void }) {
  const isCheapest = h.price != null && h.price === result.cheapest;
  return (
    <li id={`card-${h.hospitalId}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(h.hospitalId)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(h.hospitalId)}
        className={`rounded-2xl p-4 ring-1 transition ${selected ? "ring-2 ring-[var(--brand)]" : "ring-black/10"} ${isCheapest ? "bg-[var(--good-soft)]" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold leading-tight">
              {rank ? <span className="mr-1 text-[var(--muted)]">{rank}.</span> : null}
              {h.name}
            </h3>
            <p className="text-xs text-[var(--muted)]">{h.distanceKm != null ? `${(h.distanceKm * 0.621).toFixed(1)} mi away` : ""}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums">{h.price != null ? money(h.price) : "Not published"}</p>
            <p className="text-xs text-[var(--muted)]">{h.priceKind === "plan" ? `${result.payer} rate` : h.priceKind === "cash" ? "cash price" : result.payer ? `no ${result.payer} rate` : "no cash price"}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Cash price" value={money(h.cashPrice)} />
          <Stat label="Your plan" value={result.payer ? (h.planRate != null ? money(h.planRate) : "n/p") : "—"} />
          <Stat label="List price" value={money(h.grossCharge)} />
        </dl>
        {h.planRateMin != null && h.planRateMax != null && h.planRateMax - h.planRateMin > 1 && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            {result.payer} rates here range {money(h.planRateMin)}–{money(h.planRateMax)} by plan.
          </p>
        )}
        {h.cashBeatsPlan && result.payer && <p className="mt-2 text-xs font-semibold text-[var(--good)]">Cash price is lower than the {result.payer} rate here. Ask the billing office.</p>}
        {h.savingsVsMax != null && h.savingsVsMax > 0 && <p className="mt-2 text-sm font-semibold text-[var(--good)]">Save {money(h.savingsVsMax)} vs. the most expensive</p>}
        <Insurers h={h} payer={result.payer} />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          {h.fileLastUpdated && <span>File updated {h.fileLastUpdated}</span>}
          {h.partial && <span className="rounded bg-[var(--warn-soft)] px-1.5 py-0.5 text-[var(--warn)]">partial file</span>}
          {h.sourceUrl && (
            <a href={h.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--brand)] underline underline-offset-2">
              Source file ↗
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

/** Insurers with negotiated rates in this hospital's price file: evidence of a contract, not a guarantee. */
function Insurers({ h, payer }: { h: HospitalResult; payer: string | null }) {
  const [open, setOpen] = useState(false);
  if (!h.insurers.length) return null;
  const shown = open ? h.insurers : h.insurers.slice(0, 5);
  return (
    <div className="mt-3">
      {payer && (
        <p className={`mb-1.5 text-xs font-semibold ${h.hasYourInsurer ? "text-[var(--good)]" : "text-[var(--warn)]"}`}>
          {h.hasYourInsurer
            ? `✓ ${payer} has published rates here (likely in network)`
            : `No ${payer} rates published here. It may be out of network, so call to confirm.`}
        </p>
      )}
      <p className="text-[11px] text-[var(--muted)]">Insurers with published rates:</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {shown.map((p) => (
          <span key={p} className={`rounded-full px-2 py-0.5 text-[11px] ${p === payer ? "bg-[var(--good)] font-semibold text-white" : "bg-black/5"}`}>
            {p}
          </span>
        ))}
        {h.insurers.length > 5 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="rounded-full px-2 py-0.5 text-[11px] text-[var(--brand)] underline"
          >
            {open ? "show less" : `+${h.insurers.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/[0.03] p-2">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-[var(--muted)]">Reading published price files…</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-black/5" />
      ))}
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="text-[11px] leading-snug text-[var(--muted)]">
      Published estimates from hospital price transparency files, not a quote. Your cost depends on your deductible and coinsurance, and doctor fees are often billed separately. OpenTab stores no personal health information.
    </p>
  );
}

const STAGES = ["searching", "fetching", "parsing", "indexing", "done"] as const;
const STAGE_LABEL: Record<string, string> = { searching: "Searching", fetching: "Fetching", parsing: "Parsing", indexing: "Indexing", done: "Indexed" };

function AddHospital({ onDone, onClose }: { onDone: (hospitalIds: string[]) => void; onClose: () => void }) {
  const add = useMutation(api.ingest.addHospital);
  const [name, setName] = useState("");
  const [jobId, setJobId] = useState<Id<"ingestJobs"> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const job = useQuery(api.ingest.get, jobId ? { jobId } : "skip");
  const notified = useRef<string | null>(null);

  useEffect(() => {
    if (job?.status === "done" && notified.current !== job._id) {
      notified.current = job._id;
      onDone([]);
    }
  }, [job, onDone]);

  const stageIdx = job ? STAGES.indexOf(job.status as (typeof STAGES)[number]) : -1;
  return (
    <div className="w-[min(92vw,360px)] rounded-2xl bg-[var(--panel)] p-4 shadow-xl ring-1 ring-black/5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Add any hospital</h2>
        <button onClick={onClose} className="text-sm text-[var(--muted)]" aria-label="Close">
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">We find its official price file on the web and read it live.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            setJobId(await add({ hospitalName: name }));
          } catch (x) {
            setErr(cleanError(x));
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. St. Rose Hospital Hayward" className="h-10 flex-1 rounded-xl px-3 text-sm ring-1 ring-black/15 outline-none focus:ring-2 focus:ring-[var(--brand)]" />
        <button disabled={name.trim().length < 3 || (job != null && !["done", "failed"].includes(job.status))} className="h-10 rounded-xl bg-[var(--brand)] px-3 text-sm font-semibold text-white disabled:opacity-50">
          Add
        </button>
      </form>
      {err && <p className="mt-2 text-xs text-[var(--warn)]">{err}</p>}
      {job && (
        <div className="mt-4">
          <ol className="flex items-center gap-1 text-[11px] font-medium">
            {STAGES.map((s, i) => (
              <li key={s} className={`flex-1 rounded-full px-1 py-1 text-center ${job.status === "failed" ? (i <= Math.max(stageIdx, 0) ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-black/5 text-[var(--muted)]") : i < stageIdx || job.status === "done" ? "bg-[var(--good)] text-white" : i === stageIdx ? "animate-pulse bg-[var(--brand)] text-white" : "bg-black/5 text-[var(--muted)]"}`}>
                {STAGE_LABEL[s]}
              </li>
            ))}
          </ol>
          <p className={`mt-2 text-sm ${job.status === "failed" ? "text-[var(--warn)]" : ""}`}>{job.detail}</p>
          {job.status === "done" && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {job.hospitalNames?.join(", ")} added{job.via ? ` · fetched by ${job.via}` : ""}. It now appears in comparisons.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function cleanError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Convex wraps server errors: "[CONVEX A(ask:ask)] [Request ID: ...] Server Error Uncaught Error: <msg> at ..."
  const inner = m.match(/Uncaught Error:\s*([\s\S]*?)(?:\n\s+at |$)/);
  return (inner?.[1] ?? m).trim().slice(0, 300) || "Something went wrong. Please try again.";
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}
