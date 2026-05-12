# Chirp — Setup Instructions

End-to-end guide to get Chirp running on your own machine + Android device. The full system has three pieces that all need to be running:

1. **Relay server** — tiny Hono HTTP service (`chirp/relay-server/`)
2. **Merchant terminal** — Next.js web app (`terminal-web/`)
3. **Mobile app** — Expo / React Native, runs on an Android device (`chirp/`)

The merchant terminal chirps over your laptop speakers; the mobile app listens through its mic. So you need real audio output — not headphones, not Bluetooth speakers — and the phone within ~1 m of the laptop.

---

## 0. Prerequisites

| Tool | Why | Install |
| --- | --- | --- |
| Node.js ≥ 20 | All three apps | https://nodejs.org or `brew install node` |
| `git` | Clone the repo | already installed on macOS |
| `adb` | Talk to the Android device | `brew install --cask android-platform-tools` |
| `eas-cli` | Build the Android dev client APK | `npm i -g eas-cli` |
| Expo account | EAS cloud builds (free) | sign up at https://expo.dev |
| Android device | Recommended: Solana Mobile Seeker; any Android with mic + speaker works | — |

Optional but recommended:

| Tool | Why |
| --- | --- |
| `solana` CLI | Airdrop devnet SOL to test wallets — `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| Helius API key | Faster + more reliable Solana devnet RPC — free tier at https://www.helius.dev |
| `ngrok` | Expose the local relay over HTTPS so the phone can reach it without same-wifi setup — `brew install ngrok` |

Confirm everything:

```bash
node --version       # v20.x or higher
adb version          # Android Debug Bridge ≥ 1.0.41
eas --version        # ≥ 18
```

---

## 1. Clone and install

```bash
git clone <this-repo-url> consensus_hackathon
cd consensus_hackathon

# Install all three projects
( cd chirp && npm install )
( cd chirp/relay-server && npm install )
( cd terminal-web && npm install )
```

---

## 2. Find your laptop's LAN IP

The phone needs to reach the relay (and Metro). The simplest path is over the same wifi using your laptop's local IP.

```bash
# macOS, wifi
ipconfig getifaddr en0
# → e.g. 192.168.1.62

# Linux
hostname -I | awk '{print $1}'
```

Save this — you'll paste it into a few env vars below as `<LAN_IP>`.

If your laptop and phone can't share a wifi network (AP isolation, hotel wifi), skip ahead to **Section 7 — USB-only fallback** or use ngrok instead.

---

## 3. Start the relay (Terminal A)

```bash
cd chirp/relay-server
PORT=8787 npm run dev
```

You should see `relay listening on :8787`. Smoke test from another shell:

```bash
curl http://localhost:8787/health
# → {"ok":true}
```

Leave this running.

---

## 4. Start the merchant terminal (Terminal B)

```bash
cd terminal-web

# Tell the web app where the relay is. Default is localhost:8787, which is
# fine since the browser runs on your laptop too.
export NEXT_PUBLIC_CHIRP_RELAY_URL="http://localhost:8787"
# Optional: more reliable Solana devnet RPC
export NEXT_PUBLIC_HELIUS_RPC="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"

npm run dev
# → http://localhost:3000
```

Open `http://localhost:3000` in Chrome. You'll see the Chirp onboarding screen — paste a wallet pubkey or generate one. Then add a few menu items and click **Broadcast** to start chirping.

> **Volume matters.** The chirp lives in the 19–20.5 kHz band. Crank your laptop volume to ~80 %. Don't use headphones or Bluetooth speakers — they often roll off above 16 kHz and the phone won't decode anything.

---

## 5. Build the Android APK

The mobile app uses `react-native-audio-api` + Mobile Wallet Adapter, both native modules — so it can't run in plain Expo Go. You build an APK once via EAS, then sideload it.

There are two profiles. Pick based on what you're doing:

### 5a. Standalone preview APK — **recommended for judges and demos**

JS bundle is baked into the APK. No Metro, no laptop dependency at runtime — install and run.

First, point the APK at a reachable relay. Open [chirp/eas.json](chirp/eas.json) and set `EXPO_PUBLIC_CHIRP_RELAY_URL` under `build.preview.env` to either:

- An ngrok URL (`ngrok http 8787` from your laptop), or
- A deployed relay URL (Fly, Render, etc.)

A plain LAN IP (`http://192.168.x.x:8787`) won't work — Android blocks cleartext HTTP unless the manifest allows it, and ngrok/Fly give you free HTTPS.

Then build:

```bash
cd chirp
eas login          # one-time, Expo account
eas build --profile preview --platform android
```

The cloud build takes ~15 min (free tier; queue + build). EAS prints a download URL. Install on your device:

```bash
curl -L -o chirp.apk "URL_FROM_EAS_OUTPUT"
adb install -r chirp.apk
# or tap the EAS URL on the phone's browser and install directly
```

Open the Chirp app on the phone. It uses the baked-in relay URL — no Metro needed. Skip Section 6 and 7.

### 5b. Dev client APK — for iterating on the mobile code

If you're going to modify mobile code and want live reload:

```bash
cd chirp
eas build --profile development --platform android
adb install -r chirp-dev.apk
```

This APK needs Metro running on your laptop (Section 6) to fetch the JS bundle. Subsequent code changes hot-reload — no rebuild needed.

---

## 6. Run the mobile app (Terminal C)

Plug the device into your laptop via USB. Confirm it's visible:

```bash
adb devices
# List of devices attached
# ABC123XYZ   device
```

If it shows `unauthorized`, tap **Allow USB debugging** on the phone. If `adb devices` is empty, enable Developer Options on the phone (Settings → About phone → tap **Build number** 7×, then Settings → System → Developer options → toggle **USB debugging** ON).

Now start Metro with the right env vars:

```bash
cd chirp

# Tell the app where the relay is
export EXPO_PUBLIC_CHIRP_RELAY_URL="http://<LAN_IP>:8787"
export EXPO_PUBLIC_CHIRP_CHANNEL="demo"
export EXPO_PUBLIC_CHIRP_MODE="audio"     # default; use "relay" to bypass audio for debugging
export EXPO_PUBLIC_CHIRP_CLUSTER="devnet"

# Optional — better RPC
export EXPO_PUBLIC_HELIUS_RPC="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"

npx expo start --dev-client
```

On the device:

1. Open the **Chirp** app (the dev client APK you installed in Section 5)
2. It auto-discovers Metro on the same wifi and loads the JS bundle
3. If it doesn't, tap the URL banner inside the dev client app and paste `http://<LAN_IP>:8081`

You should see the Chirp home screen.

---

## 7. USB-only fallback (no shared wifi)

If the phone can't reach Metro or the relay over wifi, use `adb reverse` so the phone forwards `localhost` traffic over USB:

```bash
adb reverse tcp:8081 tcp:8081      # Metro
adb reverse tcp:8787 tcp:8787      # relay

# Then with localhost as the relay URL:
export EXPO_PUBLIC_CHIRP_RELAY_URL="http://localhost:8787"

# And launch the dev client by URL (note: the URL scheme is exp+whisper://
# because the original Expo slug was "whisper" — the installed APK is still
# the Chirp app, this is just the URL handler):
adb shell am start -a android.intent.action.VIEW \
  -d 'exp+whisper://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
```

Alternative: expose the relay over HTTPS with ngrok and use that URL instead.

```bash
ngrok http 8787
# copy the https URL it prints
export EXPO_PUBLIC_CHIRP_RELAY_URL="https://abcd-1234.ngrok-free.app"
```

The terminal-web side uses the same relay, so set `NEXT_PUBLIC_CHIRP_RELAY_URL` to the same ngrok URL and restart `npm run dev` in `terminal-web/`.

---

## 8. Wallet setup + airdrop

Connect a wallet on the device:

1. Open Chirp → **Settings** tab → **Connect**
2. Mobile Wallet Adapter prompts the device's wallet (Seed Vault on Seeker, Phantom otherwise) — approve
3. The truncated pubkey appears at the top of every screen

Get devnet SOL (need ~0.05 SOL for fees + sample payments):

```bash
solana config set --url devnet
solana airdrop 2 <YOUR_DEVICE_WALLET_PUBKEY>
solana balance <YOUR_DEVICE_WALLET_PUBKEY>
```

Repeat for the merchant wallet you pasted/generated in `terminal-web` if you want it funded too (it doesn't need funds to receive, just to send).

---

## 9. Run the demo

You should now have, simultaneously:

- **Terminal A**: `relay-server` running on `:8787`
- **Terminal B**: `terminal-web` running on `:3000`, browser tab open
- **Terminal C**: Metro running, dev client connected

Then:

1. **In the browser** (`http://localhost:3000`):
   - Add a few menu items (e.g. `Espresso 3.00 USDC`, `Croissant 0.10 SOL`)
   - Click **Broadcast** — the page emits a chirp every 5 s with a 4-digit terminal code shown big

2. **On the phone**:
   - Tap the **Pay** tab → **Listen for menus**
   - Hold the phone within 1 m of the laptop, mic facing the speaker
   - Within ~3 s, the menu appears on the phone with the same 4-digit code as the browser
   - Tap an item → review screen → **Place order**
   - Wallet prompts for signature → approve
   - Phone shows ✓ Paid with a tappable Solana Explorer link

3. **Back in the browser**: the order pops in on the cashier UI as a "paid" overlay.

Verify on-chain at https://explorer.solana.com/?cluster=devnet by pasting the signature from the phone.

---

## 10. Run the FSK protocol tests (optional)

Sanity-check the audio protocol without any device:

```bash
cd chirp
npx tsx src/services/audio/fsk.test.ts
```

10/10 should pass — clean roundtrip + noise + offset + multi-frame + four IRL acoustic simulations.

---

## 11. Production APK build (for submission / sharing)

```bash
cd chirp
eas build --platform android --profile preview
```

EAS returns a public APK download URL. That's the link you share or paste into the hackathon submission form. Note that the preview build bakes in the env vars from `eas.json` — edit `EXPO_PUBLIC_CHIRP_RELAY_URL` there to your deployed relay URL before building.

---

## Troubleshooting

### `adb devices` shows nothing
- USB debugging not enabled — Settings → Developer options
- Charge-only cable — try a different USB-C cable
- Phone's USB mode is "Charging only" — switch to "File transfer" in the notification

### Phone can't reach relay (`Network request failed`)
- Phone and laptop must be on the **same wifi** for the LAN-IP path
- Laptop firewall — temporarily disable, or allow ports 8081 and 8787
- Use the USB-only fallback (Section 7) or ngrok instead

### Chirp emits but phone doesn't decode
- **Laptop volume at max.** This is the most common cause.
- Don't use headphones or Bluetooth speakers — they roll off the ultrasonic band
- Hold phone within 1 m, mic side toward the laptop
- Set `EXPO_PUBLIC_CHIRP_MODE=relay` to bypass audio entirely and verify the rest of the flow works
- Tap **Show diagnostics** on the Pay screen — confirms whether the FSK decoder is seeing tones at all

### MWA / Wallet prompt never appears
- Make sure a Solana wallet (Seed Vault, Phantom, Solflare) is installed on the device
- On Seeker: open the Seed Vault app once first to set up biometrics

### Tx submits but never confirms
- Public devnet RPC is sometimes slow — wait 30 s
- Set `EXPO_PUBLIC_HELIUS_RPC` to a Helius devnet URL with your API key
- Check the wallet has at least ~0.001 SOL for fees

### `react-native-audio-api` build error
- Set `"newArchEnabled": true` inside the `expo` block of `chirp/app.json`
- Re-run `eas build --profile development --platform android`

### ngrok URL stopped working
- Free ngrok URLs change on each restart. Re-run `ngrok http 8787`, copy the new URL, update both `EXPO_PUBLIC_CHIRP_RELAY_URL` (mobile) and `NEXT_PUBLIC_CHIRP_RELAY_URL` (web), restart Metro and `npm run dev`.

---

## Environment variables — full reference

### `chirp/` (mobile)

| Var | Default | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_CHIRP_RELAY_URL` | `http://10.0.2.2:8787` | Where the mobile app reaches the relay. `10.0.2.2` is Android emulator → host loopback; for real devices use LAN IP or ngrok URL. |
| `EXPO_PUBLIC_CHIRP_CHANNEL` | `demo` | Logical channel ID for relay-mode chirps (audio mode ignores). |
| `EXPO_PUBLIC_CHIRP_MODE` | `audio` | `audio` = real ultrasonic FSK; `relay` = HTTP fake-chirp fallback. |
| `EXPO_PUBLIC_CHIRP_CLUSTER` | `devnet` | Solana cluster for transactions. |
| `EXPO_PUBLIC_HELIUS_RPC` | public devnet RPC | Override the Solana RPC. Strongly recommended — public devnet is rate-limited. |

### `terminal-web/` (web)

| Var | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CHIRP_RELAY_URL` | `http://localhost:8787` | Where the browser reaches the relay. |
| `NEXT_PUBLIC_HELIUS_RPC` | public devnet RPC | Same as above, for the cashier UI. |

### `chirp/relay-server/`

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Port the Hono server binds to. |
