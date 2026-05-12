/**
 * Chirp Spread Spectrum (CSS) modulation — same family as LoRa, in audible band.
 *
 * Why this exists: 4-FSK in the 19–20.5 kHz band has zero processing gain and
 * dies in real cafes. CSS encodes each symbol as a frequency *sweep* (a literal
 * chirp). Sweeps have ~12–25 dB more noise margin than fixed tones because they
 * fight ambient cafe noise via matched filtering. The brand-protocol alignment
 * is also exact — CSS literally sweeps frequency the way bird chirps do.
 *
 * Design choices for v1:
 *   - Audible band 4–7 kHz (cheap-speaker safe, brand-pleasant)
 *   - SF (spreading factor) = 4 → 16 symbols, 4 bits per symbol → ~12 dB process gain
 *   - 50 ms per symbol (matches FSK so test results compare apples-to-apples)
 *   - Cyclic upchirp encoding (LoRa-standard)
 *   - 4-byte payload (bootstrap-only architecture: chirp carries an ID, all
 *     payment data flows over WebSocket)
 *
 * Frame layout:
 *   [PREAMBLE × 2] [PAYLOAD × 8] [POSTAMBLE × 1] = 11 symbols × 50 ms = 550 ms
 *
 * Pure JS — no native deps, runnable in Node.
 */

export const SAMPLE_RATE = 48_000;
export const F_START = 4_000; // Hz — audible-band start
export const BANDWIDTH = 3_000; // Hz — sweep range (4 → 7 kHz)
export const SF = 4; // spreading factor: N = 2^SF = 16 symbols
export const N = 1 << SF;
export const BITS_PER_SYMBOL = SF;
export const SYMBOL_MS = 50;
export const SYMBOL_SAMPLES = (SAMPLE_RATE * SYMBOL_MS) / 1000;

export const PAYLOAD_BYTES = 4; // 32-bit session/venue ID
export const PAYLOAD_SYMBOLS = (PAYLOAD_BYTES * 8) / BITS_PER_SYMBOL; // 8

// PREAMBLE = 2 base upchirps (symbol 0). They are the unique sync signature.
// POSTAMBLE = symbol N-1 (last bin), distinguishable from preamble.
export const PREAMBLE: ReadonlyArray<number> = [0, 0];
export const POSTAMBLE: ReadonlyArray<number> = [N - 1];
export const FRAME_SYMBOLS =
  PREAMBLE.length + PAYLOAD_SYMBOLS + POSTAMBLE.length;

export type CssSymbol = number; // 0 .. N-1

// ───────────────────────────────────────────────────────────────────────────
// Bit packing
// ───────────────────────────────────────────────────────────────────────────

export function bytesToSymbols(bytes: Uint8Array): CssSymbol[] {
  if (bytes.length !== PAYLOAD_BYTES)
    throw new Error(`payload must be ${PAYLOAD_BYTES} bytes`);
  const out: CssSymbol[] = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push((bytes[i] >> 4) & 0x0f);
    out.push(bytes[i] & 0x0f);
  }
  return out;
}

export function symbolsToBytes(symbols: CssSymbol[]): Uint8Array {
  if (symbols.length !== PAYLOAD_SYMBOLS)
    throw new Error(`expected ${PAYLOAD_SYMBOLS} symbols`);
  const out = new Uint8Array(PAYLOAD_BYTES);
  for (let i = 0; i < PAYLOAD_BYTES; i++) {
    out[i] = ((symbols[2 * i] & 0x0f) << 4) | (symbols[2 * i + 1] & 0x0f);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Chirp generation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Render one cyclic upchirp symbol.
 *
 * Math: instantaneous frequency starts at f0 + (s/N)*BW, sweeps up at rate
 * BW/T, and wraps mod BW. Continuous phase across the wrap point — no clicks.
 *
 * Returns sin(phase) as Float32 samples plus the ending phase so consecutive
 * symbols can be concatenated without phase discontinuity.
 */
export function renderSymbol(
  s: CssSymbol,
  durationSamples: number,
  startPhase: number = 0,
  fnTrig: "sin" | "cos" = "sin",
): { samples: Float32Array; endPhase: number } {
  const out = new Float32Array(durationSamples);
  const T = durationSamples / SAMPLE_RATE;
  const sweepRate = BANDWIDTH / T;
  let phase = startPhase;
  const trig = fnTrig === "sin" ? Math.sin : Math.cos;
  for (let n = 0; n < durationSamples; n++) {
    const t = n / SAMPLE_RATE;
    const unwrappedOffset = (s / N) * BANDWIDTH + sweepRate * t;
    const wrappedOffset = unwrappedOffset % BANDWIDTH;
    const f = F_START + wrappedOffset;
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    out[n] = trig(phase);
  }
  return { samples: out, endPhase: phase };
}

/**
 * Render the full frame as Float32 PCM.
 * 5 ms raised-cosine taper at start/end to avoid speaker thump.
 */
export function encodeFrame(payload: Uint8Array): Float32Array {
  const symbols: CssSymbol[] = [
    ...PREAMBLE,
    ...bytesToSymbols(payload),
    ...POSTAMBLE,
  ];
  const totalSamples = symbols.length * SYMBOL_SAMPLES;
  const out = new Float32Array(totalSamples);

  let phase = 0;
  for (let s = 0; s < symbols.length; s++) {
    const { samples, endPhase } = renderSymbol(
      symbols[s],
      SYMBOL_SAMPLES,
      phase,
    );
    out.set(samples, s * SYMBOL_SAMPLES);
    phase = endPhase;
  }

  // Amplitude scaling + edge taper.
  const taperSamples = Math.floor(SAMPLE_RATE * 0.005);
  const amp = 0.6;
  for (let i = 0; i < totalSamples; i++) {
    let a = amp;
    if (i < taperSamples) a *= i / taperSamples;
    else if (i >= totalSamples - taperSamples)
      a *= (totalSamples - 1 - i) / taperSamples;
    out[i] *= a;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Matched-filter receiver
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pre-compute the N quadrature template pairs once. Each template covers one
 * symbol period at the standard SYMBOL_SAMPLES length.
 *
 * For non-standard window lengths (preamble hunt at fractional offsets), we
 * build templates on demand — slow but only happens during sync acquisition.
 */
const TEMPLATE_CACHE = new Map<
  number,
  { sin: Float32Array; cos: Float32Array }[]
>();

function getTemplates(
  durationSamples: number,
): { sin: Float32Array; cos: Float32Array }[] {
  const cached = TEMPLATE_CACHE.get(durationSamples);
  if (cached) return cached;
  const templates: { sin: Float32Array; cos: Float32Array }[] = [];
  for (let s = 0; s < N; s++) {
    templates.push({
      sin: renderSymbol(s, durationSamples, 0, "sin").samples,
      cos: renderSymbol(s, durationSamples, 0, "cos").samples,
    });
  }
  TEMPLATE_CACHE.set(durationSamples, templates);
  return templates;
}

/**
 * Detect the most likely symbol in a window via quadrature matched filtering.
 *
 * For each candidate s, compute |⟨received, template_s_cos⟩|² + |⟨received, template_s_sin⟩|²
 * and pick the s with the largest value. The square magnitude is the I/Q
 * power, equivalent to the dechirp-and-FFT peak in classical CSS receivers.
 *
 * Returns the best symbol and an SNR (best-power : second-best-power ratio).
 */
export function detectSymbol(samples: Float32Array): {
  symbol: CssSymbol;
  snr: number;
  totalEnergy: number;
} | null {
  const templates = getTemplates(samples.length);
  const powers = new Float64Array(N);
  let totalEnergy = 0;
  for (let i = 0; i < samples.length; i++) totalEnergy += samples[i] ** 2;
  if (totalEnergy < 1e-9) return null;

  for (let s = 0; s < N; s++) {
    let inPhase = 0;
    let quadrature = 0;
    const cosT = templates[s].cos;
    const sinT = templates[s].sin;
    for (let i = 0; i < samples.length; i++) {
      inPhase += samples[i] * cosT[i];
      quadrature += samples[i] * sinT[i];
    }
    powers[s] = inPhase * inPhase + quadrature * quadrature;
  }

  let bestS = 0;
  let secondP = 0;
  for (let s = 1; s < N; s++) if (powers[s] > powers[bestS]) bestS = s;
  for (let s = 0; s < N; s++)
    if (s !== bestS && powers[s] > secondP) secondP = powers[s];
  const snr = secondP === 0 ? Infinity : powers[bestS] / secondP;
  return { symbol: bestS, snr, totalEnergy };
}

// ───────────────────────────────────────────────────────────────────────────
// Streaming decoder (HUNTING → TRACKING state machine, mirrors FskDecoder)
// ───────────────────────────────────────────────────────────────────────────

const HUNT_STEP_SAMPLES = Math.floor(SYMBOL_SAMPLES / 8);
const PREAMBLE_SAMPLES = PREAMBLE.length * SYMBOL_SAMPLES;

type DecoderMode = "HUNTING" | "TRACKING";

export type CssDebugEvent =
  | { type: "symbol"; sym: CssSymbol; snr: number }
  | { type: "preamble" }
  | { type: "frame"; ok: boolean };

export class CssDecoder {
  private buf: Float32Array = new Float32Array(0);
  private mode: DecoderMode = "HUNTING";
  private frameSymbols: CssSymbol[] = [];

  constructor(
    private readonly onPayload: (payload: Uint8Array) => void,
    private readonly onDebug?: (e: CssDebugEvent) => void,
  ) {}

  feed(pcm: Float32Array): void {
    const merged = new Float32Array(this.buf.length + pcm.length);
    merged.set(this.buf);
    merged.set(pcm, this.buf.length);
    this.buf = merged;
    while (this.tick()) {
      /* keep going */
    }
  }

  private tick(): boolean {
    if (this.mode === "HUNTING") {
      if (this.buf.length < PREAMBLE_SAMPLES + SYMBOL_SAMPLES) return false;
      if (this.tryLockOnPreamble()) {
        this.advance(PREAMBLE_SAMPLES);
        this.mode = "TRACKING";
        this.frameSymbols = [];
        this.onDebug?.({ type: "preamble" });
        console.log("[css] LOCKED — preamble matched");
        return true;
      }
      this.advance(HUNT_STEP_SAMPLES);
      return true;
    }

    if (this.buf.length < SYMBOL_SAMPLES) return false;
    const window = this.buf.subarray(0, SYMBOL_SAMPLES);
    const detected = detectSymbol(window);
    this.advance(SYMBOL_SAMPLES);
    if (!detected) {
      this.frameSymbols.push(0);
      return true;
    }
    this.frameSymbols.push(detected.symbol);
    this.onDebug?.({ type: "symbol", sym: detected.symbol, snr: detected.snr });

    if (this.frameSymbols.length === PAYLOAD_SYMBOLS + POSTAMBLE.length) {
      const postamble = this.frameSymbols.slice(PAYLOAD_SYMBOLS);
      const postambleOk = POSTAMBLE.every((s, i) => s === postamble[i]);
      this.onDebug?.({ type: "frame", ok: postambleOk });
      const payloadSyms = this.frameSymbols.slice(0, PAYLOAD_SYMBOLS);
      const bytes = symbolsToBytes(payloadSyms);
      console.log(
        `[css] frame complete — postamble ${postambleOk ? "OK ✓" : "soft ⚠"} (got [${postamble.join(",")}], expected [${POSTAMBLE.join(",")}])`,
      );
      this.onPayload(bytes);
      this.resetToHunting();
    }
    return true;
  }

  /**
   * Preamble is 2 base upchirps in a row (symbol 0). We require both to
   * detect as symbol 0 with a confident SNR margin.
   */
  private tryLockOnPreamble(): boolean {
    let hits = 0;
    let confidentHits = 0;
    for (let i = 0; i < PREAMBLE.length; i++) {
      const start = i * SYMBOL_SAMPLES;
      const window = this.buf.subarray(start, start + SYMBOL_SAMPLES);
      const detected = detectSymbol(window);
      if (!detected) continue;
      if (detected.symbol === PREAMBLE[i]) {
        hits++;
        if (detected.snr >= 1.5) confidentHits++;
      }
    }
    return hits === PREAMBLE.length && confidentHits >= 1;
  }

  private advance(n: number) {
    this.buf = this.buf.subarray(n).slice();
  }

  private resetToHunting() {
    this.mode = "HUNTING";
    this.frameSymbols = [];
  }
}
