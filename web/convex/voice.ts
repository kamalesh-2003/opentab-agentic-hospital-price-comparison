"use node";
// Cartesia voice: the browser never sees our API key. It gets a 60-second access token that only
// allows speech-to-text and text-to-speech, and talks to Cartesia directly with it.
import { action } from "./_generated/server";

export const CARTESIA_VERSION = "2026-08-14";

export const token = action({
  args: {},
  handler: async (): Promise<{ token: string; expiresAt: number }> => {
    const key = process.env.CARTESIA_API_KEY?.trim();
    if (!key) throw new Error("Voice is not configured (missing CARTESIA_API_KEY).");
    const res = await fetch("https://api.cartesia.ai/access-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({ grants: { stt: true, tts: true }, expires_in: 60 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Voice service error (HTTP ${res.status})`);
    const { token } = (await res.json()) as { token: string };
    return { token, expiresAt: Date.now() + 55_000 };
  },
});
