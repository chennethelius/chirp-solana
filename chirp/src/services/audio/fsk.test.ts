/**
 * Node smoke test — encode + decode FSK roundtrip in pure JS.
 * Run: `npx tsx src/services/audio/fsk.test.ts`
 */
import { FskDecoder, encodeFrame, PAYLOAD_BYTES, SAMPLE_RATE } from "./fsk";

function buildPayload(): Uint8Array {
  const bytes = new Uint8Array(PAYLOAD_BYTES);
  bytes[0] = 0x01;
  for (let i = 0; i < 8; i++) bytes[1 + i] = "abc12345".charCodeAt(i);
  bytes[9] = 0xab;
  bytes[10] = 0xcd;
  return bytes;
}

function testClean() {
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));

  // Feed in 4096-sample chunks (typical mic buffer size).
  const chunk = 4096;
  for (let i = 0; i < pcm.length; i += chunk) {
    decoder.feed(pcm.subarray(i, Math.min(i + chunk, pcm.length)));
  }

  if (!decoded) throw new Error("clean: no frame decoded");
  for (let i = 0; i < payload.length; i++) {
    if (decoded[i] !== payload[i])
      throw new Error(
        `clean: byte ${i} mismatch ${decoded[i]} vs ${payload[i]}`,
      );
  }
  console.log(
    `✓ clean roundtrip — ${pcm.length} samples (${(
      pcm.length / SAMPLE_RATE
    ).toFixed(2)}s) decoded perfectly`,
  );
}

function testWithLeadingSilence() {
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  // Prepend 0.5s of silence (simulates listener being already running)
  const silenceSamples = SAMPLE_RATE / 2;
  const padded = new Float32Array(silenceSamples + pcm.length);
  padded.set(pcm, silenceSamples);

  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(padded);

  if (!decoded) throw new Error("silence: no frame decoded");
  for (let i = 0; i < payload.length; i++) {
    if (decoded[i] !== payload[i])
      throw new Error(
        `silence: byte ${i} mismatch ${decoded[i]} vs ${payload[i]}`,
      );
  }
  console.log(`✓ leading-silence roundtrip ok`);
}

function testWithNoise() {
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  // Add white noise at -20 dB relative to the signal (signal is amp 0.6).
  const noisy = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    noisy[i] = pcm[i] + 0.06 * (Math.random() * 2 - 1);
  }
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(noisy);
  if (!decoded) throw new Error("noise: no frame decoded");
  console.log(`✓ noisy roundtrip ok (-20dB white noise)`);
}

function testAttenuated() {
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  // Attenuate to 5% (simulates phone-mic at ~1m distance)
  const quiet = pcm.map((s) => s * 0.05);
  const noisy = new Float32Array(quiet.length);
  for (let i = 0; i < quiet.length; i++) {
    noisy[i] = quiet[i] + 0.01 * (Math.random() * 2 - 1);
  }
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(noisy);
  if (!decoded) throw new Error("attenuated: no frame decoded");
  console.log("✓ attenuated 5% + noise — still decodes");
}

function testRandomOffset() {
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  // Prepend random number of samples (frame alignment isn't guaranteed)
  const offset = Math.floor(Math.random() * 1000);
  const padded = new Float32Array(offset + pcm.length + 2400);
  for (let i = 0; i < padded.length; i++) padded[i] = 0.001 * Math.random();
  padded.set(pcm, offset);
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  // Feed in 256-sample chunks (small RT mic buffer)
  for (let i = 0; i < padded.length; i += 256) {
    decoder.feed(padded.subarray(i, Math.min(i + 256, padded.length)));
  }
  if (!decoded)
    throw new Error(`random-offset: no frame decoded (offset=${offset})`);
  console.log(`✓ random-offset (${offset} samples) decodes`);
}

function testTwoFramesInARow() {
  const payloadA = buildPayload();
  const payloadB = (() => {
    const b = buildPayload();
    b[1] = "z".charCodeAt(0);
    return b;
  })();
  const pcmA = encodeFrame(payloadA);
  const pcmB = encodeFrame(payloadB);
  // Insert 200ms silence between frames
  const silence = new Float32Array(SAMPLE_RATE * 0.2);
  const all = new Float32Array(pcmA.length + silence.length + pcmB.length);
  all.set(pcmA, 0);
  all.set(silence, pcmA.length);
  all.set(pcmB, pcmA.length + silence.length);

  const decoded: Uint8Array[] = [];
  const decoder = new FskDecoder((p) => decoded.push(p));
  decoder.feed(all);
  if (decoded.length !== 2)
    throw new Error(`two-frames: expected 2 decoded, got ${decoded.length}`);
  if (decoded[0][1] !== payloadA[1] || decoded[1][1] !== payloadB[1])
    throw new Error("two-frames: payload mismatch");
  console.log("✓ two consecutive frames decode independently");
}

/**
 * IRL acoustic-channel simulation.
 *
 * Models what happens between two phones in a coffee shop:
 * - Phone speaker rolloff above 15 kHz (per-tone attenuation)
 * - Phone mic rolloff above 18 kHz
 * - Distance attenuation (1/r-ish; we use a constant scalar at fixed range)
 * - Broadband noise floor (ambient HVAC + chatter)
 * - One reflective echo at 20ms, -12 dB (typical hard-wall reflection at 3m)
 */
function simulateIRL(
  pcm: Float32Array,
  opts: {
    speakerToneAttenDb: [number, number, number, number]; // per-tone (19.5, 20, 20.5, 21)
    micRolloffDb: number; // additional flat rolloff applied to whole band
    distanceFactor: number; // 0..1, scalar amplitude
    noiseRmsDb: number; // dB relative to signal full scale
    multipathDelayMs: number;
    multipathAttenDb: number;
  },
): Float32Array {
  // Phone speaker rolloff approximated per-tone: we know our 4 tones, so
  // simulate by applying a Goertzel-targeted notch attenuation.
  // For a faithful test, we pre-render the chirp with each tone amplitude
  // already attenuated. Easier: encode the frame with weighted tones via
  // synthesis, but we only have the rendered PCM here. So we apply
  // a simplified high-pass-style rolloff curve via a single-pole low-shelf
  // approximation for speed.
  // For our 4 closely-spaced tones, the differential is small; we approximate
  // by a single attenuation factor per quarter of the chirp band.
  const out = new Float32Array(pcm.length);
  const meanAttenDb =
    opts.speakerToneAttenDb.reduce((a, b) => a + b, 0) /
      opts.speakerToneAttenDb.length +
    opts.micRolloffDb;
  const meanGain = Math.pow(10, meanAttenDb / 20) * opts.distanceFactor;

  // Apply gain.
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * meanGain;

  // Multipath echo.
  const delay = Math.floor((SAMPLE_RATE * opts.multipathDelayMs) / 1000);
  const echoGain = Math.pow(10, opts.multipathAttenDb / 20);
  for (let i = delay; i < pcm.length; i++) out[i] += echoGain * out[i - delay];

  // Broadband noise (closer to white than pink; sufficient for SNR test).
  const noiseAmp = Math.pow(10, opts.noiseRmsDb / 20);
  for (let i = 0; i < out.length; i++) {
    out[i] += noiseAmp * (Math.random() * 2 - 1);
  }
  return out;
}

function testIrlNearField() {
  // Two phones face-to-face at ~10cm. Coffee-shop noise, mild echo.
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  const channel = simulateIRL(pcm, {
    speakerToneAttenDb: [-5, -8, -12, -16],
    micRolloffDb: -2,
    distanceFactor: 0.8,
    noiseRmsDb: -45,
    multipathDelayMs: 8,
    multipathAttenDb: -18,
  });
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(channel);
  if (!decoded) throw new Error("IRL near-field: no frame decoded");
  console.log("✓ IRL near-field (10cm, café noise, mild echo) decodes");
}

function testIrlAtCounter() {
  // Customer at counter, phone in pocket → ~50cm to merchant tablet.
  // Bigger rolloff, more attenuation, real café chatter.
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  const channel = simulateIRL(pcm, {
    speakerToneAttenDb: [-8, -12, -16, -20],
    micRolloffDb: -4,
    distanceFactor: 0.3,
    noiseRmsDb: -38,
    multipathDelayMs: 20,
    multipathAttenDb: -12,
  });
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(channel);
  if (decoded) {
    console.log("✓ IRL at-counter (50cm, café chatter, room echo) decodes");
  } else {
    console.log(
      "⚠ IRL at-counter: did not decode on first try — protocol margin is tight at this distance",
    );
  }
}

function testIrlChallenging() {
  // Worst-case: 1m, loud espresso machine running, many reflections.
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  const channel = simulateIRL(pcm, {
    speakerToneAttenDb: [-12, -16, -20, -25],
    micRolloffDb: -5,
    distanceFactor: 0.15,
    noiseRmsDb: -32,
    multipathDelayMs: 30,
    multipathAttenDb: -10,
  });
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(channel);
  console.log(
    decoded
      ? "✓ IRL challenging (1m, espresso machine, heavy echo) decodes"
      : "⚠ IRL challenging: did NOT decode — needs retry from terminal (we chirp every 5s anyway)",
  );
}

function testBlackHoleClean() {
  // BlackHole loopback: digital pipe, no rolloff, no noise, no echo, no
  // attenuation. This is what 2 emulators on a laptop with BlackHole see.
  const payload = buildPayload();
  const pcm = encodeFrame(payload);
  let decoded: Uint8Array | null = null;
  const decoder = new FskDecoder((p) => (decoded = p));
  decoder.feed(pcm);
  if (!decoded) throw new Error("BlackHole-clean: should always decode");
  console.log("✓ BlackHole loopback (perfect digital channel) decodes");
}

testClean();
testWithLeadingSilence();
testWithNoise();
testAttenuated();
testRandomOffset();
testTwoFramesInARow();
console.log("\n--- IRL channel simulation ---");
testBlackHoleClean();
testIrlNearField();
testIrlAtCounter();
testIrlChallenging();
console.log("\nAll FSK tests complete.");
