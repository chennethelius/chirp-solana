/**
 * Whisper audio chirp protocol — 4-tone FSK in the ultrasonic band.
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
// Pushed up toward the inaudible band (most adults can't hear above ~17 kHz,
// teens up to ~20 kHz). Stays below the 24 kHz Nyquist limit at 48 kHz sample
// rate. Must match exactly between terminal-web and chirp.
export const TONES = [19_000, 19_500, 20_000, 20_500] as const;
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
    const freq = TONES[symbols[s]];
    const omega = (2 * Math.PI * freq) / SAMPLE_RATE;
    for (let n = 0; n < SYMBOL_SAMPLES; n++) {
      const i = s * SYMBOL_SAMPLES + n;
      let amp = 0.6;
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
 * Detect the strongest tone in the window, returning the symbol value (0-3)
 * if any tone is meaningfully louder than the noise floor, else null.
 */
function detectSymbol(samples: Float32Array): {
  symbol: Symbol;
  snr: number;
} | null {
  const powers = TONES.map((f) => goertzelPower(samples, f));
  let maxIdx = 0;
  for (let i = 1; i < powers.length; i++)
    if (powers[i] > powers[maxIdx]) maxIdx = i;
  const max = powers[maxIdx];
  const others = powers.filter((_, i) => i !== maxIdx);
  const second = Math.max(...others);
  const snr = second === 0 ? Infinity : max / second;
  if (snr < 1.5) return null;
  return { symbol: maxIdx as Symbol, snr };
}

export type FskDebugEvent =
  | { type: "symbol"; sym: Symbol; snr: number }
  | { type: "silence" }
  | { type: "preamble" }
  | { type: "frame"; ok: boolean };

const HUNT_STEP_SAMPLES = Math.floor(SYMBOL_SAMPLES / 8); // ~6.25ms scan resolution
const PREAMBLE_SAMPLES = PREAMBLE.length * SYMBOL_SAMPLES;
const FRAME_PAYLOAD_TAIL_SAMPLES =
  (PAYLOAD_SYMBOLS + POSTAMBLE.length) * SYMBOL_SAMPLES;

type DecoderMode = "HUNTING" | "TRACKING";

/**
 * Streaming decoder. Feed it PCM samples in arbitrary chunks (mic callback).
 *
 * Two-phase operation:
 *   - HUNTING: scan buffer at sub-symbol resolution looking for the preamble
 *     pattern. Once found, the symbol grid is locked to that exact offset.
 *   - TRACKING: read PAYLOAD + POSTAMBLE symbols at locked symbol boundaries.
 *     If postamble verifies, emit payload bytes; either way return to HUNTING.
 *
 * This decouples decoder timing from when listening starts, so the preamble
 * acts as a true synchronization signal.
 */
export class FskDecoder {
  private buf: Float32Array = new Float32Array(0);
  private mode: DecoderMode = "HUNTING";
  private frameSymbols: Symbol[] = [];

  constructor(
    private readonly onPayload: (payload: Uint8Array) => void,
    private readonly onDebug?: (e: FskDebugEvent) => void,
  ) {}

  feed(pcm: Float32Array): void {
    // Append new samples to buffer.
    const merged = new Float32Array(this.buf.length + pcm.length);
    merged.set(this.buf);
    merged.set(pcm, this.buf.length);
    this.buf = merged;

    // Process iteratively until we can't make progress.
    while (this.tick()) {
      /* keep going */
    }
  }

  /** Advance state machine one step. Returns true if more progress is possible. */
  private tick(): boolean {
    if (this.mode === "HUNTING") {
      // Need full preamble + at least one tracking symbol of headroom.
      if (this.buf.length < PREAMBLE_SAMPLES + SYMBOL_SAMPLES) return false;

      // Try to match preamble at offset 0 of buffer.
      if (this.tryLockOnPreamble()) {
        // Lock acquired. Drop the preamble samples; payload starts at buf[0].
        this.advance(PREAMBLE_SAMPLES);
        this.mode = "TRACKING";
        this.frameSymbols = [];
        this.onDebug?.({ type: "preamble" });
        console.log("[fsk] LOCKED — preamble matched, starting payload decode");
        return true;
      }

      // No preamble at this offset; slide forward by HUNT_STEP and retry.
      this.advance(HUNT_STEP_SAMPLES);
      return true;
    }

    // TRACKING: read symbols at locked grid.
    if (this.buf.length < SYMBOL_SAMPLES) return false;

    const window = this.buf.subarray(0, SYMBOL_SAMPLES);
    const detected = detectSymbol(window);
    this.advance(SYMBOL_SAMPLES);

    if (!detected) {
      // Lost signal mid-frame. Bail and resume hunting.
      console.log(
        `[fsk] frame lost — silence at symbol ${this.frameSymbols.length}/${PAYLOAD_SYMBOLS + POSTAMBLE.length}`,
      );
      this.onDebug?.({ type: "silence" });
      this.resetToHunting();
      return true;
    }

    this.frameSymbols.push(detected.symbol);
    this.onDebug?.({ type: "symbol", sym: detected.symbol, snr: detected.snr });

    if (this.frameSymbols.length === PAYLOAD_SYMBOLS + POSTAMBLE.length) {
      // Frame complete. Verify postamble.
      const postamble = this.frameSymbols.slice(PAYLOAD_SYMBOLS);
      const ok = POSTAMBLE.every((s, i) => s === postamble[i]);
      this.onDebug?.({ type: "frame", ok });
      console.log(
        `[fsk] frame complete — postamble ${ok ? "OK ✓" : "FAIL ✗"} (got [${postamble.join(",")}], expected [${POSTAMBLE.join(",")}])`,
      );
      if (ok) {
        const payloadSyms = this.frameSymbols.slice(0, PAYLOAD_SYMBOLS);
        const bytes = symbolsToBytes(payloadSyms);
        this.onPayload(bytes);
      }
      this.resetToHunting();
    }
    return true;
  }

  /**
   * Returns true if the next PREAMBLE_SAMPLES of buffer (starting at offset 0)
   * decode to the expected preamble pattern. All 6 symbols must match.
   */
  private tryLockOnPreamble(): boolean {
    for (let i = 0; i < PREAMBLE.length; i++) {
      const start = i * SYMBOL_SAMPLES;
      const window = this.buf.subarray(start, start + SYMBOL_SAMPLES);
      const detected = detectSymbol(window);
      if (!detected) return false;
      if (detected.symbol !== PREAMBLE[i]) return false;
    }
    return true;
  }

  private advance(n: number) {
    this.buf = this.buf.subarray(n).slice();
  }

  private resetToHunting() {
    this.mode = "HUNTING";
    this.frameSymbols = [];
  }
}
