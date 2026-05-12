# Chirp (mobile)

**Pay anyone in earshot.** Chirp is a Solana Mobile dApp that uses
ultrasonic sound (19–20.5 kHz, inaudible to most adults) as the transport for
payment requests. The merchant terminal chirps a short opaque ID, every
listening Chirp customer in earshot fetches the matching payment intent or
session over HTTPS, the user reviews + signs via Mobile Wallet Adapter
(Seed Vault on Seeker, Phantom or any MWA wallet elsewhere), and the tx
settles on Solana in 400 ms.

> Solana Frontier Hackathon submission — Physical World Applications track.

> Note: the Expo project slug and the URL scheme `exp+whisper://` reflect the
> original name. The app, brand, and code paths are all Chirp.

---

## Three modes

Chirp supports three flows from the merchant side:

1. **Charge** — fixed amount, single chirp, single customer pays.
2. **Tip jar** — broadcast intent at a suggested amount; many customers in
   earshot can each pay independently.
3. **Open terminal** — the secure default. Merchant opens a session that
   chirps every 5 s with a verifiable 4-digit code. Customer phones decode,
   show the code, the customer enters their own amount, verifies the code
   matches the terminal screen, and pays.

The "Open terminal" flow is what the demo video centers on — it's the most
secure and the only one that gives the customer control over the amount.

---

## Repo layout

- `App.tsx` / `src/` — the Expo + React Native app
- `src/services/audio/fsk.ts` — pure-JS 4-tone FSK encoder/decoder + Goertzel
- `src/services/audio/audioChirpChannel.ts` — `react-native-audio-api`-backed
  chirp channel (mic + speaker)
- `src/services/audio/fsk.test.ts` — Node-side roundtrip + noise + offset tests
- `src/services/chirp.ts` — 11-byte chirp payload encoder (ver+id+CRC16)
- `src/services/chirpChannelDev.ts` — HTTP relay channel (fallback / dev)
- `src/services/chirpProvider.ts` — picks audio vs. relay channel
- `src/services/relay.ts` — typed relay client with Zod schemas
- `src/services/payment.ts` — SOL + USDC transfer builder
- `src/screens/HomeScreen.tsx` — mode picker
- `src/screens/MerchantScreen.tsx` — Charge / Tip jar / Open terminal
- `src/screens/CustomerScreen.tsx` — listens, decodes, pays (intent + session)
- `relay-server/` — Hono HTTP service for intents, sessions, and chirp pubsub

---

## Architecture

```
   Merchant terminal              Relay server                 Customer phone
   ----------------               -----------------            ----------------
   open session  ─POST session─►  /sessions{sessionCode 4281}◄──┐
   chirp every 5s ─FSK ultrasonic────────────────────────► mic  │
                                                                ▼
                                                       lookup(id) over HTTPS
                                                          │
                                                          ▼
                                                shows: code 4281
                                                       address 4Nd1…mvrK
                                                       [enter amount]
                                                          │
                                                          ▼
                                              MWA sign  → Solana via Helius
                                                          │
                                                          ▼
                                              ack signature  ──► relay
                                                          │
   Receipts list  ◄──poll session/paidPayments[]
```

---

## Audio chirp protocol

- **Carrier**: 4 tones at 17.5, 18.0, 18.5, 19.0 kHz (FSK, 2 bits/symbol)
- **Symbol rate**: 50 ms/symbol (20 baud, ~5 byte/s usable)
- **Frame**: 6-symbol preamble + 44-symbol payload (11 bytes) + 2-symbol
  postamble = **2.6 s** total
- **Decoding**: per-window Goertzel filter at the 4 tones, argmax with SNR
  threshold ≥ 1.5
- **Error detection**: CRC16-CCITT
- **Tested in Node**: clean, with -20 dB white noise, 5 % amplitude
  attenuation, random alignment offset, two-frames-in-a-row → all passing.
  See `src/services/audio/fsk.test.ts`.
- **Hardware tolerance**: any phone speaker that reaches 19 kHz; Seeker is
  fine. Cheap phones rolling off above 16 kHz can be supported later by
  shifting the band down (the design is parameterized in `fsk.ts`).

---

## Security model

The chirp transmits an **opaque 8-character ID**. All trust-bearing
information (merchant address, name, amount, accepted tokens, expiry) lives
on the relay over HTTPS. This means a chirp itself is not a payment
instruction — it's a pointer to an authenticated record.

Three layers of protection, stacked:

### Layer 1 — Visible 4-digit session code (shipped)

- The terminal generates a fresh random 4-digit code at session open and
  displays it big on screen.
- The same code is stored on the relay and shown on the customer's phone
  alongside the merchant address.
- The user **physically reads both screens** before paying. If they don't
  match, they don't tap Pay.
- Defeats: eavesdropper rebroadcasting the chirp from a different relay
  record (their fake code won't match the genuine terminal in front of you).

### Layer 2 — Replay TTL (shipped)

- Sessions live for **60 s** by default. The terminal pings
  `POST /sessions/:id/refresh` every 30 s while open.
- After `expiresAt`, the relay refuses new payment acks.
- Closed sessions retain a **5-minute grace window** so customers who tapped
  Pay just as the merchant closed don't lose their payment record.
- Defeats: record-and-replay attacks beyond 60 s of the original session.

### Layer 3 — Merchant signature (planned, post-hackathon)

- The terminal's wallet signs `(sessionId || merchantPubkey || createdAt)`
  with the same key it'll receive funds at.
- Customer phones verify the signature against the displayed pubkey before
  showing the prompt.
- Defeats: any-relay impersonation entirely. Not in v1 because it'd grow
  the chirp payload past the comfortable 11-byte budget; planned via storing
  the signature on the relay and only chirping the ID.

### Things the user has to do themselves

The user-side trust contract:

- Read the 4-digit code on the terminal screen.
- Read the truncated address on their phone.
- Match both before paying.
- Trust the displayed merchant *name* only as a hint, not as proof. (Names
  are operator-provided strings until Layer 3 ships.)

This is the same UX contract behind Solana Pay, Apple Pay's "Pay XXX?"
prompt, and Stripe Connect — short human-verifiable identifiers + an
authenticated address. The user can always cancel and check.

---

## Known limitations and intentional trade-offs

| # | Limitation | Mitigation in v1 | Long-term fix |
|---|---|---|---|
| 1 | Two terminals chirping in the same plaza overlap on the customer's mic | Customer's app shows the most recent, dedupes by ID for 30 s | Spatial / signal-strength filtering |
| 2 | Operator can put any name in `merchantName` | Customer verifies wallet address, not the name | Layer 3 signature + on-chain name service |
| 3 | Chirp duration is 2.6 s | Terminal repeats every 5 s; customers walk-up tolerant | Switch to ggwave at higher symbol rate |
| 4 | Continuous mic listening drains battery | Listener only runs while Customer tab is foregrounded | OS-level audio-burst wake (BLE proximity) |
| 5 | No ZK proof of delivery / refund flow | Tx hash + amount on-chain are the only receipt | Anchor program escrow + dispute window |
| 6 | Cheap phone speakers may roll off > 16 kHz | Demo on Seeker / current-gen Pixel | Adaptive band selection (probe and shift down) |
| 7 | Audio jamming is trivial in principle | None — out of v1 scope | FEC + frequency hopping |
| 8 | Customer has only a tx hash as a receipt | Tx is verifiable on Solana Explorer | Local receipt history view in app |

---

## Run it

### 1. Start the relay

```
cd relay-server
npm install
PORT=8787 npm run dev
```

```
curl http://localhost:8787/health
```

### 2. Configure the app

Defaults assume Android emulator on the same machine as the relay
(`http://10.0.2.2:8787`). For real devices or another laptop, set:

```
export EXPO_PUBLIC_CHIRP_RELAY_URL=https://your-relay.vercel.app
export EXPO_PUBLIC_CHIRP_CHANNEL=demo
export EXPO_PUBLIC_HELIUS_RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
# default audio mode; set to "relay" to use HTTP fake-chirp instead.
export EXPO_PUBLIC_CHIRP_MODE=audio
```

### 3. Run the app

```
npx expo start
```

Open the Android emulator (with `fakewallet` for MWA testing). Tap
**Connect** in Settings, then walk through Customer / Merchant tabs.

### 4. Demo flow (Open terminal)

1. Connect a wallet on each device (one as Merchant, one as Customer).
2. Merchant tab → tap **Open terminal**. A 4-digit code appears in giant
   letters; the phone starts chirping every 5 s.
3. Customer tab is listening — within seconds, the customer phone shows the
   same 4-digit code along with the merchant's address and an amount input.
4. Customer types `5.00`, taps **Review**, then **Confirm & sign**.
5. MWA modal opens → user confirms → tx submits to devnet.
6. Both phones update: customer shows ✓ Paid; merchant's receipts list
   shows the new payment.
7. Merchant taps **Close terminal** when done. Late acks within 5 minutes
   still land.

### 5. Build APK for submission

```
npm i -g eas-cli
eas login
eas build --platform android --profile preview
```

EAS returns a public APK download URL. Submit that URL.

---

## Dev / testing notes

### Running the audio FSK tests in Node

```
npx tsx src/services/audio/fsk.test.ts
```

Verifies clean, noisy, attenuated, offset, and multi-frame decoding without
needing a device or mic.

### Why not ggwave?

Considered. ggwave (https://github.com/ggerganov/ggwave) is the gold standard
for production data-over-sound and absolutely the right post-hackathon
upgrade. For v1 we use a custom 4-FSK because:
1. Pure JS — no WASM or native module wrapping needed
2. Tunable — we control the band, symbol rate, ECC for our exact payload
3. Testable — runs in Node without a device

The `ChirpChannel` interface in `src/services/chirp.ts` is the swap point;
adding a `GgwaveChirpChannel` is purely additive.

### Why not just QR codes?

Three things QR can't do:
1. **Broadcast** — one chirp reaches every phone in the room simultaneously
2. **Pocket-friendly** — sound diffracts; QR needs the camera and visual
   line-of-sight
3. **Cross-platform**: speaker/mic are universal; NFC is iOS-restricted

Solana is the only L1 fast/cheap enough to make pay-and-go feel instant.
