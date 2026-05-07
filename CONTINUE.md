# Whisper — Handoff for VS Code Claude

**One-liner**: Solana Mobile dApp where merchants chirp ultrasonic audio to phones in earshot. Customer phone decodes the chirp, fetches a payment intent over HTTPS, signs via Mobile Wallet Adapter (Seed Vault on Seeker), submits to Solana devnet. Built for the Easy A "Build for the dApp Store" hackathon.

## Repo layout

```
/Users/maxchen/consensus_hackathon/
├── chirp/                    # Mobile app (Expo SDK 52, RN 0.76.9)
│   ├── src/
│   │   ├── services/audio/fsk.ts          # 4-tone FSK, pure JS, Goertzel decoder
│   │   ├── services/audio/audioChirpChannel.ts  # react-native-audio-api wrapper
│   │   ├── services/audio/fsk.test.ts     # Node tests (10/10 pass)
│   │   ├── services/chirp.ts              # 11-byte payload (ver+id+CRC16)
│   │   ├── services/chirpChannelDev.ts    # HTTP relay channel (dev fallback)
│   │   ├── services/chirpProvider.ts      # picks audio vs relay channel
│   │   ├── services/relay.ts              # typed relay client (Zod schemas)
│   │   ├── services/payment.ts            # SOL + USDC tx builder
│   │   ├── screens/HomeScreen.tsx         # mode picker
│   │   ├── screens/CustomerScreen.tsx     # listens, decodes, pays
│   │   └── screens/MerchantScreen.tsx     # 3 modes (legacy — terminal moved to web)
│   ├── relay-server/                      # Hono HTTP service
│   │   └── src/server.ts                  # /intents, /sessions, /lookup, /chirp/*
│   ├── docs/
│   │   ├── RUN_ON_DEVICES.md              # full Seeker setup walkthrough
│   │   └── SETUP_BLACKHOLE.md             # macOS audio loopback for emulator
│   ├── app.json                           # Expo config (audio plugin, mic permission)
│   ├── eas.json                           # EAS build profiles
│   └── README.md                          # security model + architecture
└── terminal-web/                # Next.js 16 web terminal (replaces mobile merchant)
    ├── lib/                               # copied + web-adapted protocol code
    │   ├── fsk.ts, chirp.ts, relay.ts     # shared with mobile
    │   ├── audioEmitter.ts                # Web Audio API chirp emit
    │   └── config.ts
    └── app/
        ├── page.tsx                       # merchant config (pubkey + name)
        └── terminal/page.tsx              # 3 modes + giant code + receipts
```

## Architecture (current)

```
   Web terminal             Relay (Hono)            Mobile (Expo + Seeker)
   localhost:3000           192.168.1.62:8787       Whisper Customer tab
   ───────────────          ──────────────────      ──────────────────────
   merchant pubkey          /sessions, /intents     listen via mic →
   from localStorage        /lookup/:id             decode FSK →
   emit chirp via           /chirp/:channel         fetch session/intent →
   Web Audio API ──── ultrasonic air sound ────► customer reviews →
                                                   MWA → Seed Vault sign →
                                                   tx submits via Helius
```

**Decision**: Merchant moved from mobile app to web (matches real POS — Square, Toast). Mobile is Customer-only; the legacy `MerchantScreen.tsx` still exists as a dev fallback but isn't the primary surface.

## Audio chirp protocol

- **4 tones**: 17.5, 18.0, 18.5, 19.0 kHz (FSK, 2 bits per symbol)
- **50 ms per symbol**, 6-symbol preamble + 44-symbol payload (11 bytes) + 2-symbol postamble = **2.6 s frame**
- Goertzel filter at the 4 tones, argmax with SNR ≥ 1.5
- CRC16-CCITT for error detection
- Run tests: `cd chirp && npx tsx src/services/audio/fsk.test.ts` — 10/10 pass including IRL acoustic simulation (espresso machine + 1m + heavy echo)

## Security model

Three layers, only Layer 1+2 shipped:

1. **Visible 4-digit session code** — terminal shows giant code, customer phone shows same code, user verifies match before paying
2. **Replay TTL** — sessions expire 60s, refreshable, with 5-min post-close grace
3. **Merchant signature** (post-hackathon) — terminal wallet signs session, customer verifies sig

Plus: address-as-source-of-truth (merchantName is decorative; trust the wallet pubkey).

## Verified vs unverified

### ✅ Verified

- FSK protocol math: 10 Node tests pass (clean, noise, attenuation, offset, multi-frame, 4 IRL channel sims)
- Relay endpoints: smoke-tested every endpoint via curl including grace-period late-paid
- TypeScript compiles clean across 3 projects (mobile, relay, terminal-web)
- Web terminal builds + dev server serves both routes (200 OK)

### ⚠️ Likely works, unverified on hardware

- `react-native-audio-api` v0.7.0 actually loads on the Seeker (pinned version that doesn't need `react-native-worklets`)
- Mobile chirp listener actually captures + decodes from Seeker mic
- Browser → laptop speaker → real air → Seeker mic actually decodes
- MWA + Seed Vault wallet connect on Seeker

### ❌ Untested anywhere

- App boot on a real device
- Solana devnet tx submission via Helius
- The full demo end-to-end on real hardware

## Where things were when context compacted

User has:
- One Seeker phone connected (`adb devices` shows `SM02G4061994654`)
- Created an Expo account
- Tools installed: `adb`, `eas-cli`, `ngrok`
- Just ran `eas login`
- About to run `eas build --profile development --platform android` — first cloud build, ~10-15 min

User does NOT yet have:
- The dev client APK installed on the Seeker
- The relay running
- Metro running
- The terminal-web running

## Next steps (in order)

### 1. Wait for EAS build to complete
User runs:
```bash
cd /Users/maxchen/consensus_hackathon/chirp
eas build --profile development --platform android
```
EAS prints a build URL. ~10-15 min wait.

### 2. Install the APK on the Seeker
Once EAS finishes:
```bash
curl -L -o chirp-dev.apk "URL_FROM_EAS"
adb install -r chirp-dev.apk
```

### 3. Start the three services (3 terminals)
```bash
# Terminal A — relay
cd chirp/relay-server && PORT=8787 npm run dev

# Terminal B — web terminal
cd terminal-web && npm run dev   # http://192.168.1.62:3000

# Terminal C — Metro for the Seeker
cd chirp
export EXPO_PUBLIC_CHIRP_RELAY_URL="http://192.168.1.62:8787"
export EXPO_PUBLIC_CHIRP_CHANNEL=demo
export EXPO_PUBLIC_CHIRP_MODE=audio
npx expo start --dev-client
```

### 4. On the Seeker
Open Whisper (the dev client). Should auto-discover Metro on wifi. If not: shake phone → Configure dev server → paste `192.168.1.62:8081`.

### 5. Connect wallet + fund
Tap Settings → Connect (Seed Vault prompts). Then from laptop:
```bash
solana airdrop 2 SEEKER_PUBKEY
```

### 6. Demo flow
- Laptop browser at `http://192.168.1.62:3000`: paste Seeker pubkey or any other devnet pubkey, tap Enter terminal, tap **Open terminal** — giant 4-digit code appears, browser starts chirping every 5s
- Seeker: open Whisper → Customer tab (auto-listening)
- Hold Seeker near laptop speakers — within 3-6s, customer phone shows matching code + amount input
- Type 0.05 (SOL), Review, Confirm → Seed Vault → tx confirms

## Most likely failure modes (in priority order)

1. **`react-native-audio-api` autolinking on Expo 52** — if EAS build fails or runtime errors mention worklets/native modules, set `"newArchEnabled": true` in `app.json` expo block, rebuild dev client. Fallback: `EXPO_PUBLIC_CHIRP_MODE=relay` (HTTP fake-chirp) to ship the UX flow without audio.

2. **Laptop speakers don't reach 19 kHz cleanly** — many built-in laptop speakers roll off hard. If Seeker doesn't decode, try external speakers, or shift the FSK band down (edit `TONES` in `chirp/src/services/audio/fsk.ts` AND `terminal-web/lib/fsk.ts` — must match — to e.g., `[15500, 16000, 16500, 17000]`).

3. **Devnet RPC unreliable** — public devnet sometimes 30+ s confirms. Get a Helius API key and set `EXPO_PUBLIC_HELIUS_RPC=https://devnet.helius-rpc.com/?api-key=KEY`.

4. **Audio context suspended** — browser AudioContext starts suspended until user gesture. The `audioEmitter.ts` calls `ctx.resume()` first; if first chirp fails, the next user click fixes it.

5. **Phone can't reach relay** — phone and laptop must be on same wifi. Check laptop firewall. Or use ngrok: `ngrok http 8787`, then update `EXPO_PUBLIC_CHIRP_RELAY_URL` to the ngrok URL and restart Metro.

## Tooling status

| Tool | Installed? | For |
|---|---|---|
| `adb` | ✅ | USB device control |
| `eas-cli` | ✅ | Cloud APK builds |
| `ngrok` | ✅ | Public relay URL (only if same-wifi fails) |
| `solana` | ✅ | Devnet airdrop |
| `node` (24.6.0) | ✅ | |
| `pnpm` (10.30.3) | ✅ | |
| Android Studio | ❌ | Not needed; EAS handles builds |
| BlackHole | ❌ | Only needed for two-emulator demo (we have real phones) |

## Hackathon submission requirements

- Functional Android APK → `eas build --platform android --profile preview`
- GitHub repo → push the project to a repo
- Demo video → record after the live demo works
- Brief paragraph → see "What it is" in `chirp/README.md` opening lines

## Key contextual decisions made earlier

1. Chose FSK pure JS over `ggwave` because (a) no WASM/native deps, (b) testable in Node, (c) tunable for our exact payload
2. Chose `react-native-audio-api` v0.7.0 (not 0.12.1) because the latter requires `react-native-worklets >= 0.6.0` which conflicts with RN 0.76.9
3. Web terminal uses Next.js 16.2.5 with Tailwind 4 and the new App Router
4. Relay state is in-memory (Map) — fine for hackathon, would need Upstash/KV for serverless deploy
5. Merchant identity = wallet address (paste-an-address); merchantName is decorative until Layer 3 ships
6. Three merchant modes preserved: Charge (single intent fixed amount), Tip jar (broadcast intent), Open terminal (session, customer-controlled amount, the demo centerpiece)

## Files an agent might want to read first

1. `chirp/README.md` — security model + architecture overview
2. `chirp/docs/RUN_ON_DEVICES.md` — full device setup walkthrough
3. `chirp/src/services/audio/fsk.ts` — the protocol
4. `chirp/relay-server/src/server.ts` — the relay
5. `terminal-web/app/terminal/page.tsx` — the merchant UI
6. `chirp/src/screens/CustomerScreen.tsx` — the customer flow
