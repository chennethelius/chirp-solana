# Running Chirp on two real Seeker phones

This is the **happy path**: two real phones, real ultrasonic audio, no
BlackHole, no AVD audio routing. Total setup time the first run: ~30-45
minutes (most of it is the first EAS development build, which runs in the
cloud while you do other things).

## Prerequisites checklist

| Tool | Why | Install |
|---|---|---|
| `adb` | Connect Seekers via USB to your laptop | `brew install --cask android-platform-tools` |
| `eas-cli` | Build the Chirp APK in EAS cloud | `npm i -g eas-cli` |
| `ngrok` | Expose your localhost relay to the phones over the internet | `brew install ngrok` |
| `solana` | Airdrop devnet SOL to the Seeker wallets | already installed |

You'll also need:
- **An Expo account** for `eas login` (free)
- **An ngrok account** for `ngrok config add-authtoken …` (free tier is enough)
- **A Helius API key** for reliable devnet RPC (free tier — get one at
  https://www.helius.dev) — strictly optional, public devnet works but is
  rate-limited

## Step 1 — Get the laptop ready

```bash
cd /Users/maxchen/consensus_hackathon/chirp

# Verify everything is installed
adb version           # Android Debug Bridge ≥ 1.0.41
eas --version         # eas-cli ≥ 18
ngrok version         # ngrok ≥ 3
solana --version

# One-time logins
eas login                                 # Expo account
ngrok config add-authtoken YOUR_TOKEN     # https://dashboard.ngrok.com/auth
solana config set --url devnet            # we're on devnet for the demo
```

## Step 2 — Prepare each Seeker phone

On each Seeker:

1. **Settings → About phone** — tap **Build number** 7× until "Developer mode
   enabled" toast appears
2. **Settings → System → Developer options** → toggle **USB debugging** ON
3. Plug into the laptop via USB-C; tap **Allow USB debugging** on the phone
   when prompted

Verify both phones are visible:

```bash
adb devices
# Expected:
# List of devices attached
# ABC123XYZ   device
# DEF456UVW   device
```

If a phone shows `unauthorized`, accept the prompt on the phone.

## Step 3 — Build the Chirp development client APK

This is a one-time cloud build. Subsequent code changes don't need a rebuild;
they hot-reload via Metro.

```bash
cd /Users/maxchen/consensus_hackathon/chirp
eas build --profile development --platform android
```

EAS prompts about credentials; let it generate them. The build takes ~10-15
minutes. When it finishes, EAS prints a download URL. Either:

- **Easy**: download the APK on each phone via Chrome and tap to install
- **Faster**: download once on the laptop, then `adb install -r chirp-*.apk`
  to each device:

```bash
# Once EAS gives you the URL:
curl -L -o chirp-dev.apk "https://expo.dev/.../build.apk"
adb -s ABC123XYZ install -r chirp-dev.apk
adb -s DEF456UVW install -r chirp-dev.apk
```

## Step 4 — Run the relay over ngrok

The phones need to reach the relay over the public internet. ngrok handles
that.

In **Terminal A** (relay server):

```bash
cd /Users/maxchen/consensus_hackathon/chirp/relay-server
PORT=8787 npm run dev
```

In **Terminal B** (ngrok tunnel):

```bash
ngrok http 8787
```

ngrok prints a URL like `https://abcd-1234.ngrok-free.app`. **Copy it** —
you'll need it for the next step.

## Step 5 — Start Metro and connect phones

In **Terminal C** (Metro):

```bash
cd /Users/maxchen/consensus_hackathon/chirp

# Tell the app where the relay lives
export EXPO_PUBLIC_CHIRP_RELAY_URL="https://YOUR-NGROK-URL.ngrok-free.app"
export EXPO_PUBLIC_CHIRP_CHANNEL=demo
# Optional: better RPC reliability
export EXPO_PUBLIC_HELIUS_RPC="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"

# Audio mode is the default; explicit for clarity
export EXPO_PUBLIC_CHIRP_MODE=audio

npx expo start --dev-client
```

Now on **each Seeker**:

1. Open the **Chirp** app (the dev client you installed in Step 3)
2. It auto-discovers Metro on your laptop's wifi and loads the JS bundle
3. If it doesn't auto-discover: shake the device, **Configure development
   server**, paste your laptop's local IP from `expo start` output

You should see Chirp's home screen on both phones.

## Step 6 — Connect wallets and fund them

Each Seeker has Seed Vault built in — that's our MWA-compatible wallet, no
fakewallet needed.

On each phone:

1. **Settings tab → Connect** — Seed Vault prompts for biometric/PIN auth
2. Approve the connection
3. The wallet's pubkey appears in the top bar

Get devnet SOL from the laptop:

```bash
# For each Seeker's pubkey:
solana airdrop 2 PUBKEY_FROM_PHONE_1
solana airdrop 2 PUBKEY_FROM_PHONE_2
solana balance PUBKEY_FROM_PHONE_1
```

For USDC on devnet, mint test tokens to each phone's pubkey using the
Solana SPL token CLI (only needed for the USDC flow; SOL works without
this):

```bash
# Mint authority for devnet USDC is restricted — easiest is to spl-token
# transfer from a faucet pool. For the hackathon, just demo with SOL to
# avoid this friction.
```

For the demo I recommend **SOL only** — it's fully devnet-airdroppable.

## Step 7 — Run the demo

**Phone A (merchant)**:
1. Tap **Merchant** tab
2. Token picker → **SOL**
3. Tap **Open terminal** — a giant 4-digit code appears
4. Phone is now chirping every 5s

**Phone B (customer)**:
1. Tap **Customer** tab — status bar says "🎧 Listening for chirps…"
2. Hold near phone A
3. Within ~3 seconds: a card slides up showing the same 4-digit code,
   merchant address, and an amount input
4. Verify the code on phone B matches phone A's giant code (they should)
5. Type `0.05` (SOL) → tap **Review** → tap **Confirm & sign**
6. Seed Vault prompts → biometric/PIN → tx submits

Both phones update:
- Phone B shows ✓ Paid with the tx signature
- Phone A's Receipts list shows the new payment

You can verify the tx on https://explorer.solana.com/?cluster=devnet by
pasting the signature.

## Step 8 — Try the other modes

**Charge mode**: phone A enters amount, taps **Charge**. Single chirp,
single payment expected.

**Tip jar**: phone A taps **Tip jar**. Same flow but phone A's receipt
counts each customer that pays — try paying twice from phone B in
succession.

**Open terminal**: as above. Multiple customers can each pay independently
without closing the session.

## Iterating on the code

Once the dev client is installed (Step 3), code changes don't need a
rebuild. Just save a file; Metro pushes the update to the phones over wifi.

Reset cache if needed:
```bash
npx expo start --dev-client --clear
```

## Build the production APK for submission

```bash
eas build --platform android --profile preview
```

EAS returns a public URL. That URL goes in the hackathon submission.

## Troubleshooting

### "adb devices" shows nothing
- Make sure USB debugging is on (Settings → Developer options)
- Try a different USB cable (some are charge-only)
- On the phone, check the USB connection mode is "File transfer" not
  "Charge only"

### Metro doesn't auto-connect
- Phones and laptop need to be on the **same wifi network**
- Disable laptop firewall temporarily, or open port 8081
- Manual override: shake the phone → **Configure development server** →
  paste `LAPTOP_IP:8081`

### "Wallet not found" / Seed Vault doesn't prompt
- Seeker should ship with Seed Vault. Verify by opening Settings → Apps →
  Seed Vault. If missing, install from the Solana dApp Store.

### Chirp emits but phone B doesn't decode
- **Check phone A volume is at max** — ultrasonic 19 kHz can be quiet
- Hold phones within 1 m, ideally facing each other
- Avoid Bluetooth headphones connected (audio gets routed away from
  speakers)
- Check Metro logs for FskDecoder errors
- Fallback: `EXPO_PUBLIC_CHIRP_MODE=relay` to verify the rest of the
  flow works while audio is being debugged

### Tx submits but never confirms
- Devnet is sometimes slow; wait 30s
- Use a Helius API key (`EXPO_PUBLIC_HELIUS_RPC`)
- Check the wallet has enough SOL for fees (~0.000005 SOL per tx)

### ngrok URL stopped working
- Free ngrok URLs change on each restart. Re-run `ngrok http 8787`, copy
  the new URL, restart Metro with the new `EXPO_PUBLIC_CHIRP_RELAY_URL`.
- For a stable URL, ngrok paid plan or deploy the relay to Vercel/Fly.

### "react-native-audio-api" complains at runtime
- This package wants Expo SDK 52 with the new architecture. If a build
  error mentions worklets or autolinking, set `"newArchEnabled": true` in
  `app.json`'s expo block and rebuild the dev client.
- Worst case fallback: `EXPO_PUBLIC_CHIRP_MODE=relay` ships everything
  except the actual audio while you debug.
