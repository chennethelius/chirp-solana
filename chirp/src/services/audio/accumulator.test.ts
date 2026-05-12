/**
 * Smoke test for the byte-position vote accumulator.
 * Run: `npx tsx src/services/audio/accumulator.test.ts`
 *
 * The accumulator's job: given multiple noisy candidate frames (no single
 * one CRC-passes), recover the correct payload by majority vote per byte
 * position. We simulate this by encoding a real chirp payload, then feeding
 * the accumulator several copies with different bytes corrupted in each.
 */
import { encodeChirp } from "../chirp";
import { PayloadAccumulator } from "./accumulator";

function corruptedCopies(original: Uint8Array, n: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const copy = new Uint8Array(original);
    // Corrupt 2-3 random bytes per frame, but never the same set across
    // attempts. This mirrors real audio noise: each frame loses different
    // bytes, but no single byte is consistently wrong.
    const numCorruptions = 2 + (i % 2);
    for (let c = 0; c < numCorruptions; c++) {
      const idx = (i * 3 + c * 5) % original.length;
      copy[idx] = (copy[idx] + 1 + c) & 0xff;
    }
    out.push(copy);
  }
  return out;
}

function testRecoversFromVotes() {
  const original = encodeChirp({ requestId: "abc12345" });
  // Verify direct decode of the clean payload works (sanity).
  let accepted: { requestId: string } | null = null;
  const acc = new PayloadAccumulator((p) => {
    accepted = p;
  });
  acc.feed(original);
  if (!accepted || (accepted as { requestId: string }).requestId !== "abc12345") {
    throw new Error("clean-frame fast path failed");
  }
  console.log("✓ clean frame decodes via fast path");

  // Now simulate noise: 5 frames, each missing different bytes.
  accepted = null;
  const acc2 = new PayloadAccumulator((p) => {
    accepted = p;
  });
  const noisy = corruptedCopies(original, 5);
  for (const frame of noisy) {
    acc2.feed(frame);
    if (accepted) break;
  }
  if (!accepted || (accepted as { requestId: string }).requestId !== "abc12345") {
    throw new Error(
      `vote recovery failed — accepted=${JSON.stringify(accepted)}`,
    );
  }
  console.log("✓ majority-vote recovers payload from 5 noisy frames");

  // Edge: every frame fully wrong should NOT decode (no false positives).
  accepted = null;
  let progressFired = 0;
  const acc3 = new PayloadAccumulator(
    (p) => {
      accepted = p;
    },
    () => {
      progressFired++;
    },
  );
  for (let i = 0; i < 5; i++) {
    const trash = new Uint8Array(11);
    for (let j = 0; j < 11; j++) trash[j] = (i * 17 + j * 31) & 0xff;
    acc3.feed(trash);
  }
  if (accepted) {
    throw new Error("false positive: garbage frames should never decode");
  }
  if (progressFired === 0) {
    throw new Error("progress should fire for each noisy frame");
  }
  console.log(
    `✓ rejects pure noise (no false positives); progress fired ${progressFired}x`,
  );

  // Progress monotonicity: with 1 frame, 0 positions confirmed (overall=0).
  // With 2 frames that mostly agree, many positions confirmed (overall>0).
  // The user-facing bar must START at 0 and CLIMB, not show 100% on frame 1.
  let lastProgress: { framesReceived: number; overall: number; confirmedPositions: number } | null = null;
  const acc4 = new PayloadAccumulator(
    () => {
      /* ignore */
    },
    (p) => {
      lastProgress = p;
    },
  );
  // Two slightly-corrupted copies of the same frame.
  const f1 = new Uint8Array(original);
  const f2 = new Uint8Array(original);
  f1[3] = (f1[3] + 1) & 0xff;
  f2[7] = (f2[7] + 1) & 0xff;
  acc4.feed(f1);
  if (!lastProgress) throw new Error("progress should fire on first frame");
  // After 1 frame: every position has 1 vote, no confirmations possible.
  if ((lastProgress as { confirmedPositions: number }).confirmedPositions !== 0) {
    throw new Error(
      `1-frame confirmedPositions should be 0, got ${(lastProgress as { confirmedPositions: number }).confirmedPositions}`,
    );
  }
  if ((lastProgress as { overall: number }).overall !== 0) {
    throw new Error(
      `1-frame overall should be 0, got ${(lastProgress as { overall: number }).overall}`,
    );
  }
  acc4.feed(f2);
  // After 2 frames that agree on most positions: should have many confirmed.
  if ((lastProgress as { confirmedPositions: number }).confirmedPositions < 8) {
    throw new Error(
      `2-frame confirmedPositions should be ≥8 (frames mostly agree), got ${(lastProgress as { confirmedPositions: number }).confirmedPositions}`,
    );
  }
  console.log(
    `✓ progress climbs 0 → ${(lastProgress as { confirmedPositions: number }).confirmedPositions}/11 over 2 frames (no false 100% on frame 1)`,
  );
}

testRecoversFromVotes();
console.log("\nAll accumulator tests complete.");
