import { nanoid } from "nanoid/non-secure";

export type ChirpPayload = {
  requestId: string;
};

export type ChirpListener = (payload: ChirpPayload) => void;

export interface ChirpChannel {
  emit(payload: ChirpPayload): Promise<void>;
  listen(handler: ChirpListener): () => void;
}

const CHIRP_VERSION = 0x01;

export function encodeChirp(payload: ChirpPayload): Uint8Array {
  const id = payload.requestId.padEnd(8, "_").slice(0, 8);
  const bytes = new Uint8Array(11);
  bytes[0] = CHIRP_VERSION;
  for (let i = 0; i < 8; i++) bytes[1 + i] = id.charCodeAt(i);
  const crc = crc16(bytes.subarray(0, 9));
  bytes[9] = (crc >> 8) & 0xff;
  bytes[10] = crc & 0xff;
  return bytes;
}

export function decodeChirp(bytes: Uint8Array): ChirpPayload | null {
  if (bytes.length !== 11) return null;
  if (bytes[0] !== CHIRP_VERSION) return null;
  const expected = crc16(bytes.subarray(0, 9));
  const got = (bytes[9] << 8) | bytes[10];
  if (expected !== got) return null;
  let id = "";
  for (let i = 0; i < 8; i++) id += String.fromCharCode(bytes[1 + i]);
  return { requestId: id.replace(/_+$/, "") };
}

function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function newRequestId(): string {
  return nanoid(8);
}
