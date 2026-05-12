import { AudioContext, AudioRecorder, RecorderAdapterNode } from "react-native-audio-api";
import { PermissionsAndroid, Platform } from "react-native";

import {
  ChirpChannel,
  ChirpListener,
  ChirpPayload,
  encodeChirp,
} from "../chirp";
import { encodeFrame, FskDebugEvent, FskDecoder, SAMPLE_RATE } from "./fsk";
import { AccumulatorProgress, PayloadAccumulator } from "./accumulator";

// Audible bird-trill brand cue, prepended to every chirp transmission.
// Three FM glide pulses in the 2.5–5 kHz range, raised-cosine envelope.
// Amp kept low (0.12) to avoid pumping the receiver's mic AGC.
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
    const f0 = 2800 + p * 400;
    const f1 = 4600 + p * 300;
    let phase = 0;
    for (let n = 0; n < pulseSamples; n++) {
      const t = n / pulseSamples;
      const freq = f0 + (f1 - f0) * t;
      const omega = (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      out[cursor + n] = 0.12 * env * Math.sin(phase);
      phase += omega;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    }
    cursor += pulseSamples + (p < pulses - 1 ? gapSamples : 0);
  }
  return out;
}

// Silence gap between trill and FSK frame, so mic AGC has time to recover
// from the audible trill before the preamble starts.
const TRILL_TO_FRAME_GAP_MS = 200;

const MIC_BUFFER_SAMPLES = 4800; // 100ms chunks

export type ChirpDebugEvent =
  | { type: "audio"; peak: number; rms: number; chunks: number }
  | { type: "progress"; progress: AccumulatorProgress }
  | FskDebugEvent;

export class AudioChirpChannel implements ChirpChannel {
  private ctx: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private adapter: RecorderAdapterNode | null = null;
  private decoder: FskDecoder | null = null;
  private accumulator: PayloadAccumulator | null = null;
  private listeners = new Set<ChirpListener>();
  private debugListeners = new Set<(e: ChirpDebugEvent) => void>();
  private chunkCount = 0;

  subscribeDebug(fn: (e: ChirpDebugEvent) => void): () => void {
    this.debugListeners.add(fn);
    return () => this.debugListeners.delete(fn);
  }

  private emitDebug(e: ChirpDebugEvent) {
    for (const l of this.debugListeners) {
      try { l(e); } catch {}
    }
  }

  async emit(payload: ChirpPayload): Promise<void> {
    const ctx = this.getContext();
    const trill = birdTrill();
    const bytes = encodeChirp(payload);
    const data = encodeFrame(bytes);
    const gapSamples = Math.floor((SAMPLE_RATE * TRILL_TO_FRAME_GAP_MS) / 1000);

    const total = trill.length + gapSamples + data.length;
    const buffer = ctx.createBuffer(1, total, SAMPLE_RATE);
    const merged = new Float32Array(total);
    merged.set(trill, 0);
    // gap is implicit zeros
    merged.set(data, trill.length + gapSamples);
    buffer.copyToChannel(merged, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();

    const durationMs = (total / SAMPLE_RATE) * 1000;
    await sleep(durationMs + 200);
  }

  listen(handler: ChirpListener): () => void {
    this.listeners.add(handler);
    if (this.listeners.size === 1) {
      this.startRecording().catch((e) =>
        console.log("[chirp] startRecording failed:", e),
      );
    }
    return () => {
      this.listeners.delete(handler);
      if (this.listeners.size === 0) this.stopRecording();
    };
  }

  private async ensureMicPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return true;
    const PERM = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    const already = await PermissionsAndroid.check(PERM);
    if (already) {
      console.log("[chirp] mic permission: already granted");
      return true;
    }
    console.log("[chirp] requesting mic permission…");
    const result = await PermissionsAndroid.request(PERM, {
      title: "Microphone access",
      message: "Chirp needs the mic to hear payment chirps from nearby terminals.",
      buttonPositive: "OK",
    });
    console.log("[chirp] permission result:", result);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  private getContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    return this.ctx;
  }

  private async startRecording() {
    const granted = await this.ensureMicPermission();
    if (!granted) {
      console.log("[chirp] mic permission DENIED — aborting recorder start");
      return;
    }
    console.log("[chirp] starting recorder…");
    const ctx = this.getContext();
    const recorder = new AudioRecorder({
      sampleRate: SAMPLE_RATE,
      bufferLengthInSamples: MIC_BUFFER_SAMPLES,
    });
    const adapter = ctx.createRecorderAdapter();
    this.accumulator = new PayloadAccumulator(
      (decoded) => {
        console.log("[chirp] payload accepted (post-accumulator):", decoded);
        for (const l of this.listeners) {
          try { l(decoded); } catch {}
        }
      },
      (progress) => {
        this.emitDebug({ type: "progress", progress });
      },
    );
    this.decoder = new FskDecoder(
      (bytes) => {
        // Hand every candidate frame (regardless of postamble) to the
        // accumulator. It runs CRC on the raw bytes first; if that fails it
        // adds them to the per-position vote tally and tries again on the
        // current best-guess. Either path can succeed.
        this.accumulator?.feed(bytes);
      },
      (e) => {
        if (e.type === "preamble") console.log("[chirp] PREAMBLE matched");
        else if (e.type === "frame") console.log("[chirp] frame complete, ok=", e.ok);
        else if (e.type === "symbol") {
          console.log(`[chirp] sym=${e.sym} snr=${e.snr.toFixed(2)}`);
        }
        this.emitDebug(e);
      },
    );

    recorder.onAudioReady((event) => {
      if (!this.decoder) return;
      const pcm = event.buffer.getChannelData(0);
      this.chunkCount++;
      // Compute per-chunk audio level. Throttle emit to every 5th chunk (~500ms)
      // so we don't flood JS bridge.
      if (this.chunkCount % 5 === 0) {
        let peak = 0;
        let sumSq = 0;
        for (let i = 0; i < pcm.length; i++) {
          const v = Math.abs(pcm[i]);
          if (v > peak) peak = v;
          sumSq += pcm[i] * pcm[i];
        }
        const rms = Math.sqrt(sumSq / pcm.length);
        console.log(`[chirp] audio chunk ${this.chunkCount} peak=${peak.toFixed(3)} rms=${rms.toFixed(3)}`);
        this.emitDebug({ type: "audio", peak, rms, chunks: this.chunkCount });
      }
      this.decoder.feed(pcm);
    });

    recorder.connect(adapter);
    recorder.start();

    this.recorder = recorder;
    this.adapter = adapter;
  }

  private stopRecording() {
    try {
      this.recorder?.stop();
      this.recorder?.disconnect();
    } catch {}
    this.recorder = null;
    this.adapter = null;
    this.decoder = null;
    this.accumulator = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
