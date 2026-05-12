import { ChirpPayload, decodeChirp } from "../chirp";
import { PAYLOAD_BYTES } from "./fsk";

/**
 * Byte-position vote accumulator for noisy FSK frames.
 *
 * The encoder emits the same 11-byte payload back-to-back. Each frame the
 * receiver picks up may have errors at different byte positions. By keeping
 * a per-position vote histogram across multiple frames, we can recover a
 * payload that no individual frame got right — as long as the *correct*
 * value at each position eventually wins its column's vote.
 *
 *   frame 1: A B X D E F G H I J K   <- byte 2 wrong
 *   frame 2: A B C D Y F G H I J K   <- byte 4 wrong
 *   frame 3: A B C D E F Z H I J K   <- byte 6 wrong
 *   ────────────────────────────────
 *   votes:   A B C D E F G H I J K   <- correct (each correct value won 2-3 votes)
 *
 * After each new frame we rebuild the best-guess payload and run CRC on it.
 * The first time CRC passes we accept and reset.
 *
 * If the raw incoming frame itself CRC-passes (best case, common after the
 * preamble + decoder relaxations), we short-circuit and emit immediately.
 */
const POSITIONS = PAYLOAD_BYTES; // 11
const MAX_FRAMES = 12; // give up after this many failed CRCs (probably wrong session/noise)
const RESET_AFTER_MS = 2_500; // silence longer than this ⇒ new broadcast, start fresh
const CONFIRM_VOTES = 2; // a byte position is "confirmed" once its top value has this many votes

export type AccumulatorProgress = {
  framesReceived: number;
  /** Per byte position: top-vote share (0..1). 1.0 = all frames agreed. */
  positionConfidence: number[];
  /** Number of byte positions that have a confirmed (≥2 vote) consensus. */
  confirmedPositions: number;
  /**
   * Progress for UI: confirmedPositions / 11. Starts at 0 with the first
   * frame (no votes ≥2 yet) and climbs as redundant frames lock in each
   * byte. NOT the same as overall agreement — agreement is trivially
   * 100% with one frame because the frame agrees with itself.
   */
  overall: number;
  /** Best-guess payload as of this frame, for debug overlays. */
  bestGuess: Uint8Array;
};

export class PayloadAccumulator {
  private votes: Map<number, number>[] = [];
  private framesReceived = 0;
  private lastFrameAt = 0;

  constructor(
    private readonly onPayload: (payload: ChirpPayload) => void,
    private readonly onProgress?: (p: AccumulatorProgress) => void,
  ) {
    this.resetState();
  }

  private resetState() {
    this.votes = Array.from({ length: POSITIONS }, () => new Map());
    this.framesReceived = 0;
    this.lastFrameAt = 0;
  }

  /**
   * External reset, e.g. when the listening screen re-mounts or a payload
   * was accepted upstream and we want a fresh accumulation window.
   */
  reset() {
    this.resetState();
  }

  feed(bytes: Uint8Array) {
    if (bytes.length !== POSITIONS) return;

    const now = Date.now();
    if (
      this.framesReceived > 0 &&
      now - this.lastFrameAt > RESET_AFTER_MS
    ) {
      this.resetState();
    }
    this.lastFrameAt = now;

    // Best-case fast path: raw frame already CRC-valid. Skip vote work.
    const direct = decodeChirp(bytes);
    if (direct) {
      console.log("[accumulator] direct CRC pass on first try");
      this.onPayload(direct);
      this.resetState();
      return;
    }

    // Add votes for each byte position.
    for (let p = 0; p < POSITIONS; p++) {
      const v = bytes[p];
      this.votes[p].set(v, (this.votes[p].get(v) ?? 0) + 1);
    }
    this.framesReceived++;

    // Build best guess from per-position modes.
    const guess = new Uint8Array(POSITIONS);
    const confidence = new Array<number>(POSITIONS);
    let confirmedPositions = 0;
    for (let p = 0; p < POSITIONS; p++) {
      let bestVal = 0;
      let bestCount = 0;
      for (const [val, count] of this.votes[p]) {
        if (count > bestCount) {
          bestVal = val;
          bestCount = count;
        }
      }
      guess[p] = bestVal;
      confidence[p] = bestCount / this.framesReceived;
      if (bestCount >= CONFIRM_VOTES) confirmedPositions++;
    }

    const overall = confirmedPositions / POSITIONS;
    this.onProgress?.({
      framesReceived: this.framesReceived,
      positionConfidence: confidence,
      confirmedPositions,
      overall,
      bestGuess: guess,
    });

    const decoded = decodeChirp(guess);
    if (decoded) {
      console.log(
        `[accumulator] CRC pass after ${this.framesReceived} frames — recovered via vote`,
      );
      this.onPayload(decoded);
      this.resetState();
      return;
    }

    if (this.framesReceived >= MAX_FRAMES) {
      console.log(
        `[accumulator] giving up after ${MAX_FRAMES} frames — likely stale session or pure noise; resetting`,
      );
      this.resetState();
    }
  }
}
