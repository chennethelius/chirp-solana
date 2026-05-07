import { decodeChirp } from "./chirp";
import { FskDecoder, FskDebugEvent, SAMPLE_RATE } from "./fsk";

export type ChirpHeard = { requestId: string };

export type ListenerStats = {
  chunks: number;
  peak: number;
  rms: number;
  symCounts: [number, number, number, number];
  lastSym: -1 | 0 | 1 | 2 | 3;
  lastSnr: number;
  preambles: number;
  framesOk: number;
  framesBad: number;
};

export type Listener = {
  stop: () => void;
  onStats: (cb: (stats: ListenerStats) => void) => () => void;
};

const EMPTY_STATS: ListenerStats = {
  chunks: 0,
  peak: 0,
  rms: 0,
  symCounts: [0, 0, 0, 0],
  lastSym: -1,
  lastSnr: 0,
  preambles: 0,
  framesOk: 0,
  framesBad: 0,
};

// Browser microphone listener. Captures audio via getUserMedia + a
// ScriptProcessor, feeds samples into the same FskDecoder we use on mobile.
//
// In addition to firing onChirp on a successful decode, exposes a stats
// callback so the terminal UI can render mic-level meters + per-tone bars.
export async function startListening(
  onChirp: (heard: ChirpHeard) => void,
): Promise<Listener> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor({ sampleRate: SAMPLE_RATE });
  if (ctx.state === "suspended") await ctx.resume();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const source = ctx.createMediaStreamSource(stream);

  const stats: ListenerStats = { ...EMPTY_STATS, symCounts: [0, 0, 0, 0] };
  const subs = new Set<(s: ListenerStats) => void>();
  let lastEmit = 0;
  const emit = () => {
    const now = performance.now();
    if (now - lastEmit < 100) return;
    lastEmit = now;
    const snapshot: ListenerStats = {
      ...stats,
      symCounts: [...stats.symCounts] as [number, number, number, number],
    };
    subs.forEach((s) => s(snapshot));
  };

  const decoder = new FskDecoder((bytes) => {
    const decoded = decodeChirp(bytes);
    if (decoded) onChirp({ requestId: decoded.requestId });
  });
  // The mobile FskDecoder has a `subscribeDebug` hook; the web copy doesn't
  // (yet). Patch the streaming decoder via the new optional debug callback —
  // the underlying fsk.ts now supports it.
  if (typeof (decoder as unknown as { onDebug?: unknown }).onDebug !==
    "undefined") {
    (decoder as any).onDebug = (e: FskDebugEvent) => {
      if (e.type === "symbol") {
        stats.symCounts[e.sym]++;
        stats.lastSym = e.sym as ListenerStats["lastSym"];
        stats.lastSnr = e.snr;
      } else if (e.type === "preamble") stats.preambles++;
      else if (e.type === "frame")
        e.ok ? stats.framesOk++ : stats.framesBad++;
      emit();
    };
  }

  const bufferSize = 4096;
  const proc = (ctx as any).createScriptProcessor(bufferSize, 1, 1);
  proc.onaudioprocess = (e: AudioProcessingEvent) => {
    const ch = e.inputBuffer.getChannelData(0);
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sumSq += v * v;
    }
    stats.chunks++;
    stats.peak = peak;
    stats.rms = Math.sqrt(sumSq / ch.length);
    decoder.feed(new Float32Array(ch));
    emit();
  };

  source.connect(proc);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  proc.connect(sink);
  sink.connect(ctx.destination);

  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        proc.disconnect();
      } catch {}
      try {
        source.disconnect();
      } catch {}
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
      ctx.close().catch(() => {});
    },
    onStats: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
