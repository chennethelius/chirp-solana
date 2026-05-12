# Chirp Audio Protocol

A self-contained technical reference for the over-air payment ID transport that powers Chirp. This is the protocol that runs identically on the merchant web terminal (Web Audio API) and the customer mobile app (`react-native-audio-api`).

> Implementation lives in [chirp/src/services/audio/fsk.ts](chirp/src/services/audio/fsk.ts) and [terminal-web/lib/fsk.ts](terminal-web/lib/fsk.ts). They MUST stay byte-for-byte equivalent.

---

## 1. What flows over the air

The over-air payload is **always opaque and fixed-size**: 11 bytes. It does not carry merchant identity, amount, or items. It carries only an ID that both sides resolve against the relay.

```
Air payload (11 bytes):
┌──────────┬───────────────────────────────┬─────────────┐
│  ver (1) │           id (8)              │  crc16 (2)  │
└──────────┴───────────────────────────────┴─────────────┘
            ↑
            8 ASCII chars, base32-ish, e.g. "K7XQ29NP"
```

- `ver` — protocol version byte (currently `0x01`)
- `id` — 8 bytes (8 ASCII characters from a deliberately confusable-safe alphabet) identifying a session, intent, or order
- `crc16` — CRC16-CCITT over `ver || id`, used to discard noise-induced false positives at the decoder

Everything else (merchant pubkey, menu items, prices, payer pubkey, signatures, the 4-digit human-verifiable code) lives in the relay and is fetched via `/lookup/:id` over HTTPS *after* the chirp decodes.

This two-tier design keeps the on-air payload small enough to send in 2.6 seconds without sacrificing context. The protocol is essentially a wireless URL shortener for payment intents.

---

## 2. Frame anatomy

```
Full frame: 52 symbols × 50 ms = 2.6 seconds total

┌─────────────┬────────────────────────────────────┬───────────┐
│  PREAMBLE   │              PAYLOAD               │ POSTAMBLE │
│  6 symbols  │  44 symbols (11 bytes × 4 syms/B)  │ 2 symbols │
│   300 ms    │              2.2 s                 │   100 ms  │
└─────────────┴────────────────────────────────────┴───────────┘
```

- **Symbol**: 50 ms of a single sinusoid at one of 4 tones — encodes 2 bits.
- **Preamble**: `[0, 3, 0, 3, 1, 2]` — an oscillating pattern between the lowest and highest tones, then dropping into the two middle tones. Designed so that a half-frame slip in the decoder still produces a recognisable correlation peak, but a random tone sequence has near-zero chance of matching.
- **Postamble**: `[3, 0]` — short closer for frame boundary disambiguation. The experimental decoder tolerates a 1-of-2 mismatch here and lets CRC arbitrate.
- **Inter-frame gap**: emitters wait 200 ms between successive frames to give decoders a clean preamble hunt window.

The frame is preceded by a short audible **bird trill** — three FM glide pulses at 2.8–4.6 kHz. This is purely a branding/affordance cue (so users hear "something happened"); the data layer remains ultrasonic.

---

## 3. The tone band

```
TONES = [19_000, 19_500, 20_000, 20_500] Hz
```

| Constraint                       | Why this band fits                                     |
|----------------------------------|--------------------------------------------------------|
| Above adult hearing (~17 kHz)    | 19 kHz is reliably inaudible for >25-year-olds         |
| Below Nyquist at 48 kHz          | Top tone is 20.5 kHz, well under 24 kHz Nyquist        |
| Within consumer speaker response | Most laptop and phone speakers reach 20 kHz cleanly    |
| Within consumer mic response     | MEMS mics on modern phones extend to ~22 kHz           |
| 500 Hz tone spacing              | Wide enough for Goertzel discrimination at 50 ms / tone |

**Fallback band** (if speakers roll off): `[15_500, 16_000, 16_500, 17_000]`. Audible to younger ears but still tolerable. Both `chirp/src/services/audio/fsk.ts` and `terminal-web/lib/fsk.ts` must be updated together — they are intentionally duplicated rather than shared because the mobile app cannot import from the web project.

---

## 4. Encoder

Per-symbol generation uses **phase-continuous sinusoid synthesis** across symbol boundaries — the phase accumulator carries over between symbols even when the frequency changes. This eliminates click artefacts that would otherwise leak energy into adjacent bands and confuse the decoder.

A **5 ms raised-cosine taper** at frame start and end (`amp *= i / taperSamples`) prevents speaker-cone thump on attack/release. The amplitude steady-state is `0.6`, scaled per-tone by a **pre-emphasis curve** `[1.0, 1.2, 1.4, 1.6]` to compensate for consumer-speaker rolloff in the 19–20.5 kHz band — without it, the highest tone arrives at the mic ~4× weaker than the lowest, making symbol 3 misdetect significantly more often than symbol 0. Max scaled amplitude is `0.6 × 1.6 = 0.96`, still under clipping.

The audible bird trill that precedes the FSK frame is rendered at `0.12` amplitude (deliberately quiet) with a `200 ms silence gap` between trill end and preamble start — both choices give the receiver's mic AGC time to recover from the trill transient before the data preamble begins. Without these, the first chirp after silence had a noticeably worse decode rate than back-to-back successors.

```
encodeFrame(payload: Uint8Array) → Float32Array
  payload.length === PAYLOAD_BYTES (11) — enforced
  symbols = [...PREAMBLE, ...bytesToSymbols(payload), ...POSTAMBLE]
  for each symbol s, for each sample n:
    phase += 2π · TONES[s] / SAMPLE_RATE
    out[i] = 0.6 · sin(phase) · taper(i)
```

Mobile playback goes through [audioChirpChannel.ts](chirp/src/services/audio/audioChirpChannel.ts) which wraps `react-native-audio-api` v0.7.0 (pinned because newer versions require `react-native-worklets >= 0.6.0` which conflicts with RN 0.76.9 on Expo SDK 52). Web playback uses [audioEmitter.ts](terminal-web/lib/audioEmitter.ts) via standard Web Audio API.

---

## 5. Decoder

The decoder is built around a **Goertzel filter bank** rather than an FFT. This is the right choice when you know in advance the small handful of frequencies you care about — Goertzel is O(N) per tone with no transform overhead, and for our 4 tones × 50 ms / symbol it's roughly 10× cheaper than an FFT.

```
Per-symbol decode:
  samples = audio_buffer[symbol_offset : symbol_offset + SYMBOL_SAMPLES]
  powers  = [goertzelPower(samples, f) for f in TONES]
  symbol  = argmax(powers)
  snr     = powers[symbol] / mean(powers - {powers[symbol]})
  accept  = (snr >= 1.5)
```

The **SNR ≥ 1.5** threshold is calibrated against the IRL simulation tests in [fsk.test.ts](chirp/src/services/audio/fsk.test.ts), specifically the "1m away with espresso machine + heavy echo" scenario. Below this threshold the symbol is discarded; the frame becomes a candidate for **byte-vote recovery** (see § 7).

**Preamble hunt**: the decoder slides a 6-symbol window across the incoming stream, scoring each position by how many slots match the canonical preamble. The current main-branch implementation requires an exact match; the experimental branch (`experiment/css-rs-modulation`) accepts ≥5/6 matches with ≥3 high-SNR slots and relies on CRC16 to arbitrate false starts. This trades a small false-positive rate (~1 in 2^16) for substantially better recovery in noisy environments.

---

## 6. Error model

**Error sources, ranked by frequency in real conditions:**

1. **Speaker rolloff above 19 kHz** — laptop speakers vary wildly. Some MacBook models reproduce 20 kHz cleanly; others roll off 15 dB by 19 kHz. The fallback band (15.5–17 kHz) exists for this reason.
2. **Background noise (espresso machines, HVAC, music)** — most noise sources have energy below 5 kHz; the ultrasonic band is naturally quiet, which is the whole reason this band works for data.
3. **Path attenuation** — sound pressure drops 6 dB per doubling of distance. At >2 m most consumer-grade phones lose enough SNR that decode becomes unreliable. This is a **feature**, not a bug — it's the same physical mechanism that makes the protocol proximity-bound.
4. **Sample offset / clock drift** — sender and receiver clocks don't perfectly align. The decoder hunts for the preamble across sample offsets within a sliding window; multi-frame retransmission ensures eventual lock.

**Error detection**: CRC16-CCITT over `ver || id`. A single-bit error in payload bytes flips ~50% of CRC bits on average; the decoder discards any frame whose computed CRC doesn't match the embedded one.

**Error recovery (main)**: emit the chirp repeatedly (every 5 s). If any single frame decodes cleanly, payment proceeds.

**Error recovery (experimental, on `experiment/css-rs-modulation`)**: a `PayloadAccumulator` votes byte-by-byte across multiple successive frames. Each frame contributes to a histogram per byte position; the decoder declares a byte "locked" when one value dominates with margin. This makes the protocol robust to frames where different bytes happen to be wrong — a more realistic noise model than "the whole frame is right or wrong." See [chirp/src/services/audio/accumulator.ts](chirp/src/services/audio/accumulator.ts).

---

## 7. Security model

The over-air payload carries no signature. This is deliberate — 11 bytes is not enough space for a meaningful Ed25519 signature, and adding one would push the frame past 4 seconds (acceptable in the lab, painful in line at a coffee shop). Security is achieved at higher layers.

### Layer 1: Visible 4-digit code (shipped)
- Terminal displays a giant 4-digit code on screen.
- Customer phone, after decoding the chirp, shows the **same** code derived from the same session ID.
- User visually verifies the codes match before tapping "place order."
- This defeats spoofed broadcasts (an attacker emitting fake chirps from a distance can't make the customer's phone show a code that matches the real terminal screen).

### Layer 2: Replay TTL (shipped)
- Sessions expire after 60 seconds; refreshable.
- 5-minute post-close grace window for late-paid customers (someone whose phone finally decoded as the cashier closed out).
- Replay attempts after expiry are rejected by the relay.

### Layer 3: Merchant signature (designed, not shipped)
- Terminal keypair signs each session payload.
- Customer phone verifies signature against on-chain registry of trusted merchants.
- Post-hackathon; not in the v1 critical path.

### Address-as-source-of-truth
- `merchantName` in any payload is **decorative only**. The customer wallet always shows the receiving pubkey before signing.
- This means a spoofed merchant name doesn't compromise payment integrity — the worst case is the customer paying the *real* merchant under a fake brand label, which the merchant can refund.

### Threat model — out of scope
- Physical theft of merchant device (same as any POS)
- Compromised customer wallet (same as any crypto payment)
- Sophisticated audio relay attacks across rooms (mitigated by 4-digit code visual verification)

---

## 8. Why FSK (and not something fancier)

FSK is the simplest possible modulation scheme that lets us hit 11 bytes in 2.6 seconds with no native dependencies and full Node testability. It's not the most noise-resilient scheme — it has **zero processing gain** (one symbol decoded from one symbol-time of samples) — but it works.

**Considered and rejected for v1:**

- **ggwave** — the obvious off-the-shelf option. Rejected because (a) WASM dependency complicates RN/Expo integration, (b) opaque payload sizes don't fit our 11-byte spec cleanly, (c) we wanted a protocol we could iterate on for the specific use case.
- **OFDM** — multiple subcarriers, much higher throughput. Overkill for 11 bytes and adds substantial implementation complexity.
- **DTMF-style audible tones** — works, but the audible band conflicts with merchant ambience (music, voices, espresso machines) much more than the ultrasonic band.

**Experimental, on `experiment/css-rs-modulation`:** CSS (Chirp Spread Spectrum), the same modulation family as LoRa. Each symbol is a frequency sweep rather than a single tone, and the decoder uses matched filtering (correlate the received signal against the expected sweep template). This buys 12–25 dB of processing gain compared to FSK — much more noise margin for the same bandwidth. SF=4 spreading factor encodes 4 bits per symbol; an 8-symbol payload + 2 preamble + 1 postamble = 11 symbols total = ~550 ms per frame, vs FSK's 2.6 s. Audible band (4–7 kHz) chosen for branding ("the chirp sounds like a chirp"). Decoder and encoder are implemented in [chirp/src/services/audio/css.ts](chirp/src/services/audio/css.ts); not yet wired into the customer app.

---

## 9. Constants reference

| Constant         | Value             | File location                    |
|------------------|-------------------|----------------------------------|
| `SAMPLE_RATE`    | 48,000 Hz         | `fsk.ts:13` (both)               |
| `TONES`          | 19/19.5/20/20.5 kHz | `fsk.ts:17` (both)             |
| `SYMBOL_MS`      | 50                | `fsk.ts:18` (both)               |
| `SYMBOL_SAMPLES` | 2,400             | derived                          |
| `PREAMBLE`       | [0, 3, 0, 3, 1, 2] | `fsk.ts:20` (both)              |
| `POSTAMBLE`      | [3, 0]            | `fsk.ts:21` (both)               |
| `PAYLOAD_BYTES`  | 11                | `fsk.ts:22` (both)               |
| `FRAME_SYMBOLS`  | 52                | `fsk.ts:24` (both)               |
| Frame duration   | 2.6 s             | derived                          |
| Bird trill       | 2.8–4.6 kHz FM    | `audioEmitter.ts` / `audioChirpChannel.ts` |

---

## 10. Tests

```bash
cd chirp
npx tsx src/services/audio/fsk.test.ts
```

Ten cases, all currently passing:

| Case                     | What it verifies                                  |
|--------------------------|---------------------------------------------------|
| `clean roundtrip`        | Encode → decode with no channel impairment        |
| `white noise`            | Decode under additive Gaussian noise              |
| `attenuation`            | Decode at low amplitude (distance proxy)          |
| `sample offset`          | Decode across sub-symbol clock drift              |
| `multi-frame`            | Decode the first of two concatenated frames       |
| `BlackHole loopback`     | Mac virtual audio device round trip               |
| `near-field`             | High-SNR realistic phone-to-phone                 |
| `at-counter`             | 30 cm, ambient cafe noise                         |
| `1 m with espresso`      | Worst realistic case in the design envelope       |
| `multi-frame consensus`  | Byte-vote recovery from two partially-bad frames  |

The "1 m with espresso" case is the design margin floor. If real-device testing reveals decode failure at this distance, the fallback band (15.5–17 kHz) is the first remedy; reducing target distance to <50 cm is the second.
