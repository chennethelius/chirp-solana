import { decodeChirp, ChirpPayload } from "./chirp";
import { PAYLOAD_BYTES } from "./fsk";

/**
 * Byte-position vote accumulator. See chirp/src/services/audio/accumulator.ts
 * for the rationale — this file is the terminal-web mirror so the cashier
 * page benefits from the same noise-tolerant decoding when listening for
 * customer order chirps.
 */
const POSITIONS = PAYLOAD_BYTES;
const MAX_FRAMES = 12;
const RESET_AFTER_MS = 2_500;
const CONFIRM_VOTES = 2;

export type AccumulatorProgress = {
  framesReceived: number;
  positionConfidence: number[];
  confirmedPositions: number;
  overall: number;
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

    const direct = decodeChirp(bytes);
    if (direct) {
      this.onPayload(direct);
      this.resetState();
      return;
    }

    for (let p = 0; p < POSITIONS; p++) {
      const v = bytes[p];
      this.votes[p].set(v, (this.votes[p].get(v) ?? 0) + 1);
    }
    this.framesReceived++;

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
      this.onPayload(decoded);
      this.resetState();
      return;
    }

    if (this.framesReceived >= MAX_FRAMES) {
      this.resetState();
    }
  }
}
