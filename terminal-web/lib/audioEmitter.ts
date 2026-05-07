import { encodeChirp, ChirpPayload } from "./chirp";
import { encodeFrame, SAMPLE_RATE } from "./fsk";

let cachedCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!cachedCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    cachedCtx = new Ctor({ sampleRate: SAMPLE_RATE });
  }
  return cachedCtx;
}

/**
 * Render a short bird-like trill — three FM glide pulses in the 2.5–5 kHz
 * range. Audible (it's the "Chirp" brand cue) but very short, so the
 * coffee-shop polish stays intact. Each pulse is shaped with a raised-cosine
 * envelope to avoid clicks.
 */
function birdTrill(): Float32Array {
  const pulseMs = 70;
  const gapMs = 30;
  const pulses = 3;
  const totalMs = pulses * pulseMs + (pulses - 1) * gapMs;
  const totalSamples = Math.floor((SAMPLE_RATE * totalMs) / 1000);
  const out = new Float32Array(totalSamples);
  const pulseSamples = Math.floor((SAMPLE_RATE * pulseMs) / 1000);
  const gapSamples = Math.floor((SAMPLE_RATE * gapMs) / 1000);

  let cursor = 0;
  for (let p = 0; p < pulses; p++) {
    // Each pulse glides upward — that's the canonical "tweet" shape.
    const f0 = 2800 + p * 400;
    const f1 = 4600 + p * 300;
    let phase = 0;
    for (let n = 0; n < pulseSamples; n++) {
      const t = n / pulseSamples;
      const freq = f0 + (f1 - f0) * t;
      const omega = (2 * Math.PI * freq) / SAMPLE_RATE;
      // Raised cosine envelope for a soft attack/release — sounds bird-like
      // rather than blippy.
      const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      out[cursor + n] = 0.35 * env * Math.sin(phase);
      phase += omega;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    }
    cursor += pulseSamples + (p < pulses - 1 ? gapSamples : 0);
  }
  return out;
}

/**
 * Emit a chirp via the browser Web Audio API.
 *
 * The audio packet starts with a short audible bird trill (brand cue) and
 * then transmits the data payload via ultrasonic FSK so the actual data
 * portion stays inaudible to humans.
 */
export async function emitChirp(payload: ChirpPayload): Promise<number> {
  const ctx = getCtx();
  if (ctx.state === "suspended") await ctx.resume();

  const trill = birdTrill();
  const bytes = encodeChirp(payload);
  const data = encodeFrame(bytes);

  const total = trill.length + data.length;
  const buffer = ctx.createBuffer(1, total, SAMPLE_RATE);
  const ch = buffer.getChannelData(0);
  ch.set(trill, 0);
  ch.set(data, trill.length);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();

  const durationMs = (total / SAMPLE_RATE) * 1000;
  await new Promise((r) => setTimeout(r, durationMs + 100));
  return durationMs;
}

/**
 * Pure audible bird tweet — used by the cashier UI for confirmation moments
 * where there's no FSK data to transmit (e.g., a payment landed).
 */
export async function chime(kind: "ok" | "alert" = "ok"): Promise<void> {
  const ctx = getCtx();
  if (ctx.state === "suspended") await ctx.resume();
  const trill = kind === "ok" ? birdTrill() : birdTrill().reverse();
  const buffer = ctx.createBuffer(1, trill.length, SAMPLE_RATE);
  buffer.copyToChannel(trill as Float32Array<ArrayBuffer>, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  await new Promise((r) =>
    setTimeout(r, (trill.length / SAMPLE_RATE) * 1000 + 50),
  );
}
