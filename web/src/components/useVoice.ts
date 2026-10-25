"use client";
// Voice in/out with Cartesia, straight from the browser using a short-lived token from Convex.
//  - Speech-to-text: mic -> 16 kHz PCM (AudioWorklet) -> wss://api.cartesia.ai/stt/websocket (ink-whisper)
//  - Text-to-speech: POST https://api.cartesia.ai/tts/bytes (sonic-3) -> mp3 -> <audio>
import { useCallback, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

const VERSION = "2026-08-14";
const VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"; // "Skylar": approachable American voice
const RATE = 16000;
const SILENCE_MS = 1300; // stop after this much silence once speech has started
const MAX_MS = 15000; // hard stop

export type VoiceState = "idle" | "connecting" | "listening" | "finishing" | "speaking" | "error";

// Captures mic audio as Float32 frames on the audio thread.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("ot-tap", Tap);
`;

export function useVoice() {
  const getToken = useAction(api.voice.token);
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const token = useCallback(async () => {
    let t = tokenRef.current;
    if (!t || t.expiresAt < Date.now()) {
      t = await getToken({});
      tokenRef.current = t;
    }
    return t.token;
  }, [getToken]);

  /** Listen until the person stops talking; resolves with the final transcript ("" if nothing heard). */
  const listen = useCallback(async (): Promise<string> => {
    setError(null);
    setTranscript("");
    setState("connecting");
    audioRef.current?.pause();
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let ws: WebSocket | null = null;
    try {
      const [tok, media] = await Promise.all([
        token(),
        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      ]);
      stream = media;
      // Chrome/Safari can record straight into a 16 kHz context; Firefox can't, so fall back to the
      // device rate and downsample below.
      try {
        ctx = new AudioContext({ sampleRate: RATE });
        ctx.createMediaStreamSource(stream).disconnect();
      } catch {
        await ctx?.close().catch(() => {});
        ctx = new AudioContext();
      }
      const ratio = ctx.sampleRate / RATE;
      const url = new URL("wss://api.cartesia.ai/stt/websocket");
      url.search = new URLSearchParams({
        model: "ink-whisper",
        language: "en",
        encoding: "pcm_s16le",
        sample_rate: String(RATE),
        cartesia_version: VERSION,
        access_token: tok,
      }).toString();
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      await new Promise<void>((res, rej) => {
        ws!.onopen = () => res();
        ws!.onerror = () => rej(new Error("Could not connect to the voice service"));
      });

      const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "ot-tap");
      src.connect(node);
      setState("listening");

      return await new Promise<string>((resolve) => {
        let finals = "";
        let interim = "";
        let pending: Float32Array[] = [];
        let pendingLen = 0;
        let heardSpeech = false;
        let lastLoud = Date.now();
        const started = Date.now();
        let finishing = false;
        let done = false;

        const finish = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          node.port.onmessage = null;
          try {
            ws?.send("close");
          } catch {}
          setTimeout(() => ws?.close(), 300);
          resolve((finals + interim).trim());
        };
        const stop = () => {
          if (finishing) return;
          finishing = true;
          setState("finishing");
          flush();
          try {
            ws?.send("finalize");
          } catch {}
          setTimeout(finish, 2500); // in case flush_done never arrives
        };
        stopRef.current = stop;

        const flush = () => {
          if (!pendingLen || ws?.readyState !== WebSocket.OPEN) return;
          const pcm = new Int16Array(pendingLen);
          let o = 0;
          for (const f of pending) for (let i = 0; i < f.length; i++) pcm[o++] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
          ws.send(pcm.buffer);
          pending = [];
          pendingLen = 0;
        };

        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (finishing) return;
          const f = ratio > 1.01 ? downsample(e.data, ratio) : e.data;
          let sum = 0;
          for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
          const rms = Math.sqrt(sum / f.length);
          if (rms > 0.02) {
            heardSpeech = true;
            lastLoud = Date.now();
          }
          pending.push(f);
          pendingLen += f.length;
          if (pendingLen >= RATE / 10) flush(); // ~100 ms chunks, as Cartesia recommends
        };

        ws!.onmessage = (e) => {
          const m = JSON.parse(String(e.data)) as { type: string; text?: string; is_final?: boolean; message?: string };
          if (m.type === "transcript") {
            if (m.is_final) {
              finals += m.text ?? "";
              interim = "";
            } else interim = m.text ?? "";
            setTranscript((finals + interim).trim());
          } else if (m.type === "flush_done" || m.type === "done") {
            finish();
          } else if (m.type === "error") {
            setError(m.message ?? "Voice error");
            finish();
          }
        };
        ws!.onclose = () => finish();

        const timer = setInterval(() => {
          const now = Date.now();
          if ((heardSpeech && now - lastLoud > SILENCE_MS) || now - started > MAX_MS || (!heardSpeech && now - started > 7000)) stop();
        }, 150);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/denied|NotAllowed/i.test(msg) ? "Microphone access was blocked. Allow it in your browser, or type your question." : msg);
      setState("error");
      return "";
    } finally {
      stopRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      setState((s) => (s === "error" ? s : "idle"));
    }
  }, [token]);

  /** Stop listening early (e.g. second tap on the mic). */
  const stopListening = useCallback(() => stopRef.current?.(), []);

  /** Speak a short answer with Cartesia Sonic. */
  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      try {
        setState("speaking");
        const res = await fetch("https://api.cartesia.ai/tts/bytes", {
          method: "POST",
          headers: { Authorization: `Bearer ${await token()}`, "Cartesia-Version": VERSION, "Content-Type": "application/json" },
          body: JSON.stringify({
            model_id: "sonic-3",
            transcript: text.slice(0, 600),
            voice: { id: VOICE_ID },
            language: "en",
            output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
          }),
        });
        if (!res.ok) throw new Error(`Voice playback failed (HTTP ${res.status})`);
        const url = URL.createObjectURL(await res.blob());
        audioRef.current?.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setState("idle");
        };
        await audio.play();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState("idle");
      }
    },
    [token],
  );

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    setState("idle");
  }, []);

  return { state, transcript, error, listen, stopListening, speak, stopSpeaking };
}

/** Average-downsample Float32 audio by a (possibly fractional) ratio. */
function downsample(input: Float32Array, ratio: number): Float32Array {
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}
