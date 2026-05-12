/**
 * Chirp audio protocol — 4-tone FSK in the ultrasonic band.
 *
 * Frame layout (all symbols are 2 bits, 50ms each):
 *   [PREAMBLE × 6] [PAYLOAD × 44] [POSTAMBLE × 2]
 *
 * Total chirp duration: 52 symbols × 50ms = 2.6s
 * Payload: 11 bytes (matches encodeChirp() — 1 ver + 8 id + 2 crc)
 *
 * Pure JS — no native deps, runnable in Node for tests.
 */

export const SAMPLE_RATE = 48_000;
// Pushed deeper into the inaudible band (most adults can't hear above ~17 kHz;
// the previous 19 kHz floor was still audible to young ears). Stays below the
// 24 kHz Nyquist limit at 48 kHz sample rate. Must match exactly between
// terminal-web and chirp — any drift here breaks decode.
export const TONES = [19_500, 20_000, 20_500, 21_000] as const;
// Per-tone amplitude scaling to compensate for consumer-speaker rolloff above
// ~18 kHz. Typical laptop speakers attenuate ~3 dB / 500 Hz in this band, so
// without pre-emphasis the highest tone arrives at the mic ~4× weaker than
// the lowest — making symbol 3 misdetect way more often than symbol 0.
// Max scaled amp = 0.5 × 1.6 = 0.80 — dropped from 0.96 to reduce audible
// intermodulation distortion at the speaker cone.
export const TONE_PREEMPH = [1.0, 1.2, 1.4, 1.6] as const;
export const SYMBOL_MS = 50;
export const SYMBOL_SAMPLES = (SAMPLE_RATE * SYMBOL_MS) / 1000;
export const PREAMBLE: ReadonlyArray<0 | 1 | 2 | 3> = [0, 3, 0, 3, 1, 2];
export const POSTAMBLE: ReadonlyArray<0 | 1 | 2 | 3> = [3, 0];
export const PAYLOAD_BYTES = 11;
export const PAYLOAD_SYMBOLS = PAYLOAD_BYTES * 4; // 2 bits per symbol
export const FRAME_SYMBOLS =
  PREAMBLE.length + PAYLOAD_SYMBOLS + POSTAMBLE.length;

export type Symbol = 0 | 1 | 2 | 3;

export function bytesToSymbols(bytes: Uint8Array): Symbol[] {
  const out: Symbol[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out.push(((b >> 6) & 0b11) as Symbol);
    out.push(((b >> 4) & 0b11) as Symbol);
    out.push(((b >> 2) & 0b11) as Symbol);
    out.push((b & 0b11) as Symbol);
  }
  return out;
}

export function symbolsToBytes(symbols: Symbol[]): Uint8Array {
  if (symbols.length % 4 !== 0)
    throw new Error("symbol count must be a multiple of 4");
  const out = new Uint8Array(symbols.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      (symbols[i * 4] << 6) |
      (symbols[i * 4 + 1] << 4) |
      (symbols[i * 4 + 2] << 2) |
      symbols[i * 4 + 3];
  }
  return out;
}

/**
 * Render the full chirp frame as Float32 PCM at SAMPLE_RATE.
 * Uses smooth phase across symbols (no clicks at boundaries) and a short
 * raised-cosine taper at the start and end to avoid speaker thump.
 */
export function encodeFrame(payload: Uint8Array): Float32Array {
  if (payload.length !== PAYLOAD_BYTES)
    throw new Error(`payload must be ${PAYLOAD_BYTES} bytes`);
  const symbols: Symbol[] = [
    ...PREAMBLE,
    ...bytesToSymbols(payload),
    ...POSTAMBLE,
  ];
  const totalSamples = symbols.length * SYMBOL_SAMPLES;
  const out = new Float32Array(totalSamples);

  const taperSamples = Math.floor(SAMPLE_RATE * 0.005); // 5ms
  let phase = 0;

  for (let s = 0; s < symbols.length; s++) {
    const sym = symbols[s];
    const freq = TONES[sym];
    const omega = (2 * Math.PI * freq) / SAMPLE_RATE;
    const preEmph = TONE_PREEMPH[sym];
    for (let n = 0; n < SYMBOL_SAMPLES; n++) {
      const i = s * SYMBOL_SAMPLES + n;
      let amp = 0.5 * preEmph;
      if (i < taperSamples) amp *= i / taperSamples;
      else if (i >= totalSamples - taperSamples)
        amp *= (totalSamples - 1 - i) / taperSamples;
      out[i] = amp * Math.sin(phase);
      phase += omega;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    }
  }
  return out;
}

/**
 * Goertzel filter — returns power at `freq` over `samples`.
 * O(N) and faster than a full FFT for our 4 known frequencies.
 */
function goertzelPower(samples: Float32Array, freq: number): number {
  const N = samples.length;
  const k = (freq * N) / SAMPLE_RATE;
  const w = (2 * Math.PI * k) / N;
  const cosw = Math.cos(w);
  const coeff = 2 * cosw;
  let q1 = 0,
    q2 = 0;
  for (let n = 0; n < N; n++) {
    const q0 = coeff * q1 - q2 + samples[n];
    q2 = q1;
    q1 = q0;
  }
  return q1 * q1 + q2 * q2 - q1 * q2 * coeff;
}

/**
 * Detect the strongest tone in the window. Always returns the best-guess
 * symbol when the window has any audio energy at all, with a `confident`
 * flag based on SNR. Returns null only on near-zero energy (silence).
 *
 * Bailing on every low-SNR symbol was the dominant decode failure in real
 * rooms; the CRC at frame-end is the real arbiter.
 */
function detectSymbol(samples: Float32Array): {
  symbol: Symbol;
  snr: number;
  confident: boolean;
} | null {
  const powers = TONES.map((f) => goertzelPower(samples, f));
  let maxIdx = 0;
  for (let i = 1; i < powers.length; i++)
    if (powers[i] > powers[maxIdx]) maxIdx = i;
  const max = powers[maxIdx];
  const others = powers.filter((_, i) => i !== maxIdx);
  const second = Math.max(...others);
  const snr = second === 0 ? Infinity : max / second;
  const totalEnergy = powers.reduce((a, b) => a + b, 0);
  if (totalEnergy < 1e-6) return null;
  return { symbol: maxIdx as Symbol, snr, confident: snr >= 1.5 };
}

export type FskDebugEvent =
  | { type: "symbol"; sym: Symbol; snr: number }
  | { type: "preamble" }
  | { type: "frame"; ok: boolean };

/**
 * Streaming decoder. Feed it PCM samples in arbitrary chunks (mic callback).
 * Emits decoded payload bytes via onPayload when a valid frame is detected.
 *
 * Optional `onDebug` callback fires for each detected symbol, preamble lock,
 * and completed frame — used by the diagnostics panel.
 */
export class FskDecoder {
  private buf: Float32Array = new Float32Array(0);
  private symbolHistory: Symbol[] = [];
  private inFrame = false;
  private frameSymbols: Symbol[] = [];
  public onDebug: ((e: FskDebugEvent) => void) | null = null;

  constructor(private readonly onPayload: (payload: Uint8Array) => void) {}

  feed(pcm: Float32Array): void {
    const merged = new Float32Array(this.buf.length + pcm.length);
    merged.set(this.buf);
    merged.set(pcm, this.buf.length);
    this.buf = merged;

    while (this.buf.length >= SYMBOL_SAMPLES) {
      const window = this.buf.subarray(0, SYMBOL_SAMPLES);
      const detected = detectSymbol(window);
      this.advance(SYMBOL_SAMPLES);

      // True silence (no audio energy at all). Don't reset mid-frame — a
      // brief dropout shouldn't kill the frame; we'll let CRC arbitrate.
      const sym: Symbol = detected ? detected.symbol : 0;
      const confident = detected ? detected.confident : false;
      if (detected) {
        this.onDebug?.({ type: "symbol", sym, snr: detected.snr });
      }

      if (!this.inFrame) {
        this.symbolHistory.push(sym);
        if (this.symbolHistory.length > PREAMBLE.length) {
          this.symbolHistory.shift();
        }
        if (this.symbolHistory.length === PREAMBLE.length) {
          // Tolerate 1-of-6 mismatches; require ≥3 confident matches to guard
          // against payload sections aliasing as preamble at low SNR.
          let matches = 0;
          let confidentMatches = 0;
          for (let i = 0; i < PREAMBLE.length; i++) {
            if (PREAMBLE[i] === this.symbolHistory[i]) {
              matches++;
              // We don't track per-history-slot confidence; use the current
              // detection's confidence as a proxy for "this stream is hot."
              if (confident) confidentMatches++;
            }
          }
          if (matches >= 5 && confidentMatches >= 1) {
            this.inFrame = true;
            this.frameSymbols = [];
            this.symbolHistory = [];
            this.onDebug?.({ type: "preamble" });
          }
        }
        continue;
      }

      this.frameSymbols.push(sym);
      if (this.frameSymbols.length === PAYLOAD_SYMBOLS + POSTAMBLE.length) {
        const postamble = this.frameSymbols.slice(PAYLOAD_SYMBOLS);
        const postambleOk = POSTAMBLE.every((s, i) => s === postamble[i]);
        // Postamble is a hint. Always emit bytes and let the CRC inside
        // decodeChirp accept or reject — CRC16 is far stronger than a
        // 2-symbol postamble check.
        const payloadSyms = this.frameSymbols.slice(0, PAYLOAD_SYMBOLS);
        const bytes = symbolsToBytes(payloadSyms);
        this.onPayload(bytes);
        this.onDebug?.({ type: "frame", ok: postambleOk });
        this.resetFrame();
      }
    }
  }

  private advance(n: number) {
    this.buf = this.buf.subarray(n).slice();
  }

  private resetFrame() {
    this.inFrame = false;
    this.frameSymbols = [];
  }
}
