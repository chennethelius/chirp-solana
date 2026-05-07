import { ChirpChannel } from "./chirp";
import { DevRelayChirpChannel } from "./chirpChannelDev";
import { WHISPER_CONFIG } from "../config";

let cached: ChirpChannel | null = null;

/**
 * Resolve the active ChirpChannel.
 *
 * Default: real audio (FSK ultrasonic via react-native-audio-api).
 * Set EXPO_PUBLIC_WHISPER_CHIRP=relay to fall back to the HTTP relay channel
 * — useful when the audio API isn't available (Expo Go, simulator without
 * mic, etc).
 */
export function getChirpChannel(): ChirpChannel {
  if (cached) return cached;

  const mode = process.env.EXPO_PUBLIC_WHISPER_CHIRP ?? "audio";

  if (mode === "relay") {
    cached = new DevRelayChirpChannel(
      WHISPER_CONFIG.relayBaseUrl,
      WHISPER_CONFIG.chirpChannelId,
    );
    return cached;
  }

  // Lazy-load AudioChirpChannel so missing native module doesn't crash on
  // platforms where react-native-audio-api isn't linked (e.g. Expo Go).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AudioChirpChannel } = require("./audio/audioChirpChannel");
    cached = new AudioChirpChannel();
    return cached!;
  } catch (e) {
    console.warn(
      "[whisper] AudioChirpChannel unavailable, falling back to relay:",
      e,
    );
    cached = new DevRelayChirpChannel(
      WHISPER_CONFIG.relayBaseUrl,
      WHISPER_CONFIG.chirpChannelId,
    );
    return cached;
  }
}
