import {
  ChirpChannel,
  ChirpListener,
  ChirpPayload,
  decodeChirp,
  encodeChirp,
} from "./chirp";

export class DevRelayChirpChannel implements ChirpChannel {
  private listeners = new Set<ChirpListener>();
  private es: EventSource | null = null;

  constructor(private relayBaseUrl: string, private channelId: string) {}

  async emit(payload: ChirpPayload): Promise<void> {
    const bytes = encodeChirp(payload);
    const b64 = bytesToBase64(bytes);
    const res = await fetch(`${this.relayBaseUrl}/chirp/${this.channelId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: b64 }),
    });
    if (!res.ok) throw new Error(`relay emit failed: ${res.status}`);
  }

  listen(handler: ChirpListener): () => void {
    this.listeners.add(handler);
    if (!this.es) this.openStream();
    return () => {
      this.listeners.delete(handler);
      if (this.listeners.size === 0) this.closeStream();
    };
  }

  private openStream() {
    const url = `${this.relayBaseUrl}/chirp/${this.channelId}/listen`;
    const poll = async () => {
      let cursor = 0;
      while (this.listeners.size > 0) {
        try {
          const res = await fetch(`${url}?cursor=${cursor}`);
          if (!res.ok) throw new Error(`status ${res.status}`);
          const { events, next } = (await res.json()) as {
            events: Array<{ payload: string }>;
            next: number;
          };
          for (const ev of events) {
            const bytes = base64ToBytes(ev.payload);
            const decoded = decodeChirp(bytes);
            if (decoded) for (const l of this.listeners) l(decoded);
          }
          cursor = next;
        } catch {
          await sleep(1000);
        }
      }
    };
    poll();
  }

  private closeStream() {
    this.es?.close();
    this.es = null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return globalThis.btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
