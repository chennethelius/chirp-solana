# Chirp — pay by sound, on Solana

> **Built for the Easy A "Build for the dApp Store" hackathon · Solana Mobile track.**

## What it is

**Chirp is a Solana payments app where money moves between two devices that can hear each other.**

A merchant terminal (web) chirps a short, opaque payment ID over ultrasonic audio that everyone within a few feet hears as a brief bird-like trill. Any phone running Chirp picks up that chirp through its microphone, decodes it, fetches the merchant's menu and price options, and lets the customer pick what they want. The phone then chirps back the order to the cashier — so the cashier sees the order land on screen — and signs the Solana transaction with the user's Phantom wallet via Mobile Wallet Adapter. Funds settle in under a second.

It feels like Apple Pay, but instead of NFC it uses sound — so it works without tapping, without QR codes, without knowing each other's wallet addresses. Anyone in earshot can pay anyone else in earshot. Inaudible by default, audibly cute when you want it to be.

---

## Why people would want to use it

- **No NFC, no QR codes, no Bluetooth pairing.** If two phones can hear each other, they can transact. Works through cracked screens, gloves, or one-handed.
- **Group-friendly.** A coffee-shop cashier broadcasts once and everybody in the line can pay independently. A street performer puts a tip jar terminal on a phone and dozens of phones around them can hear it.
- **Real Solana.** Every payment is a real on-chain transaction. Customer signs with their own wallet (Phantom via Mobile Wallet Adapter on the Seeker). Merchant never holds the funds. SOL or USDC.
- **Verifiable.** Each completed payment shows a tappable signature that opens Solana Explorer — useful both as a receipt and as proof to the merchant.
- **Built for Solana Mobile.** Chirp is designed around the Seeker's strengths: Seed Vault as the signing root, MWA as the protocol, and the device's better-than-laptop microphone and speaker for clean ultrasonic capture.

---

## How the protocol works

```
   Web terminal               Relay (Hono)            Mobile (Expo + Seeker)
   ───────────────             ──────────────          ──────────────────────
   Cashier configures menu     /sessions, /intents     "Pay" tab listens via mic →
   + wallet, taps "Broadcast"  /orders, /lookup        decodes chirp →
                               /chirp/* (dev relay)    fetches session/menu →
   Emits chirp every 5 s ──── ultrasonic air sound ──► customer picks item →
   Mic listens for orders ◄── ultrasonic air sound ─── phone chirps order back →
   Decoded order pops          /orders/:id/settle     MWA → Seed Vault sign →
   on screen with item                                tx submits via Helius →
   Paid overlay + bird chime                          green check + Explorer link
```

**Two layers:**

1. **Audio chirp** — 4-tone FSK in the 19–20.5 kHz band (above adult hearing). 50 ms per symbol, 6-symbol preamble + 44-symbol payload (11 bytes) + 2-symbol postamble. CRC16-CCITT. Pure JS, runs identically on web (Web Audio API) and mobile (`react-native-audio-api`). Each chirp is prefaced with a short audible bird trill — three FM glide pulses at 2.8–4.6 kHz — that's just brand and "something happened" feedback; data still travels in ultrasonic.
2. **Relay** — a tiny Hono HTTP server (`whisper/relay-server/`) where the chirp payload lives. The 11-byte chirp carries an opaque 8-character ID; both sides resolve that ID via `/lookup/:id` to a session, intent, or order with full context (merchant pubkey, menu items, item picked, payer pubkey, etc.). In-memory store with TTL — fine for the hackathon, would map cleanly to KV on Vercel.

---

## Repo layout

```
.
├── README.md                          ← you are here
├── CONTINUE.md                        ← multi-session handoff doc
├── whisper/                           ← Mobile app (Expo SDK 52, RN 0.76.9)
│   ├── App.tsx
│   ├── app.json                       ← name=Chirp, plugins, perms
│   ├── eas.json
│   ├── src/
│   │   ├── components/ui/             ← Glass, BirdLogo, PopButton, Card, BalanceCard
│   │   ├── navigators/                ← bottom tabs (Home / Pay / Receipts / Receive / Settings)
│   │   ├── screens/                   ← all 5 screens
│   │   ├── services/audio/            ← FSK encoder/decoder + audio channel + tests
│   │   ├── services/                  ← chirp payload, relay client, payment tx builder
│   │   ├── utils/                     ← haptics, fonts, useBalance, receipts, MWA helpers
│   │   ├── theme.ts                   ← graphite + bone + amber palette
│   │   └── polyfills.ts
│   └── relay-server/                  ← Hono HTTP relay (sessions/intents/orders/chirp)
│
└── terminal-web/                      ← Merchant terminal (Next.js 16, App Router)
    ├── app/
    │   ├── page.tsx                   ← onboarding (create or paste wallet)
    │   ├── terminal/page.tsx          ← menu builder + broadcast + mic listener + overlays
    │   └── layout.tsx                 ← Geist Sans + Instrument Serif via next/font
    ├── components/                    ← BirdLogo, BalancePanel
    └── lib/                           ← FSK, chirp, relay client, audioEmitter (with bird trill),
                                         audioListener (mic + Goertzel), wallet utils, theme
```

---

## Running it locally

You need three terminals on the same wifi as the phone, plus a Solana Mobile Seeker (or any Android dev client).

### 1. Relay (terminal A)

```bash
cd whisper/relay-server
npm install
PORT=8787 npm run dev
# listens on :8787 — health check at /health
```

### 2. Web cashier (terminal B)

```bash
cd terminal-web
npm install
npm run dev
# http://localhost:3000  →  onboarding
# http://localhost:3000/terminal  →  cashier (after creating/pasting a wallet)
```

### 3. Mobile dev client (terminal C)

```bash
cd whisper
npm install
# pull devnet config + LAN IP
export EXPO_PUBLIC_WHISPER_RELAY_URL="http://<your-laptop-lan-ip>:8787"
export EXPO_PUBLIC_WHISPER_CHIRP=audio   # or "relay" for HTTP fallback
npx expo start --dev-client
```

If you don't already have a Chirp dev client APK installed on the device:

```bash
# one-time, ~10–15 min cloud build:
eas build --profile development --platform android
# install the resulting APK:
curl -L -o /tmp/chirp.apk "<URL EAS prints>"
adb install -r /tmp/chirp.apk
```

If the device can't reach Metro over wifi (firewall / AP isolation), use USB tunneling:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787
adb shell am start -a android.intent.action.VIEW \
  -d 'exp+whisper://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
```

### 4. Demo flow

1. **Cashier** (`/terminal`) — create or paste a wallet, build a menu (default has Espresso/Latte/Croissant), tap **Broadcast**. The terminal chirps every 5 s and starts listening on the mic.
2. **Phone** — open Chirp → **Home** → connect Phantom → **Pay** tab → **Start listening**. Hold near the laptop. The menu lands within ~3–6 s with the merchant's verify code.
3. **Phone** — pick an item (or enter a custom amount) → **Place order →**. Phone chirps the order back; cashier shows a glassy `Order toast` and chimes.
4. **Phone** — Phantom opens, sign + submit. Customer screen shows the white-check confirmation with a tappable signature link to Solana Explorer.
5. **Cashier** — full-screen `Paid` overlay with the amount + bird chime.
6. **Phone** — open the **Receipts** tab; the payment is now persisted there with a one-tap link to its Explorer page.

---

## Hackathon submission checklist

- [x] **Functional Android APK** — `eas build --profile development --platform android` (or `--profile preview` for a non-dev-client APK). The current build artifact lives at the EAS dashboard for project `whisper` (slug retained for project-id stability; the app name in `app.json` is `Chirp`).
- [x] **GitHub repository** — this repo.
- [ ] **Demo video / presentation** — record after the live demo works on hardware.
- [x] **Brief paragraph** — see [What it is](#what-it-is) + [Why people would want to use it](#why-people-would-want-to-use-it).

---

## Tests

The FSK protocol has a Node-side test harness with 10 cases — clean roundtrip, white noise, attenuation, sample-offset, multi-frame, plus four IRL channel sims (BlackHole loopback, near-field, at-counter, and "1 m away with espresso machine + heavy echo"):

```bash
cd whisper
npx tsx src/services/audio/fsk.test.ts
```

All 10 pass at the current 19/19.5/20/20.5 kHz tone band.

---

## Contextual decisions

1. **Pure-JS FSK over `ggwave`** — no WASM/native deps, testable in Node, tunable for the exact 11-byte payload.
2. **Merchant terminal on web** — matches real POS (Square, Toast). The mobile app is customer-only by default; legacy `MerchantScreen` is now an explainer tab pointing to the web terminal.
3. **Two-tier protocol** — chirp carries an opaque 8-char ID; the actual payment context (merchant, menu, items, amounts, payer) lives in the relay. Keeps the over-air payload tiny and the protocol simple.
4. **Audible bird trill** — chirp emissions start with a short FM glide pulse so users have a "something happened" cue. The data layer stays ultrasonic.
5. **Address as source of truth** — `merchantName` is decorative; trust the wallet pubkey. Customer always sees the receiving address before signing.
6. **One accent color** — Apple-Wallet-inspired graphite + bone-white with a single warm amber. Used only on live status, balances, and CTAs. The rest is hairlines, generous space, and weight-driven typography (Instrument Serif + Geist Sans on web; iOS New York / Android serif on mobile).
7. **Explorer-linked receipts** — every payment persists locally via AsyncStorage and exposes a tappable signature → Solana Explorer link, so the user always has proof.
