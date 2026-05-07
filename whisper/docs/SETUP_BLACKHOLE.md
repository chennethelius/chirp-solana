# Two-emulator audio routing on macOS via BlackHole

This is **only** needed when you want two Android emulators on one laptop to
chirp ultrasonic audio between each other. If one of your devices is a real
phone, skip this — real audio through air works fine.

## Why this is needed

The Android emulator's microphone defaults to **None** (silence). Even if you
flip it to "Use host audio input", macOS routes the laptop's built-in mic →
emulator's `AudioRecord`. Going emulator-A-speaker → laptop-speaker → air →
laptop-mic → emulator-B-mic technically works, but two things kill the
ultrasonic signal:

1. **macOS's voice processing** strips frequencies it considers "speaker
   bleed" via acoustic echo cancellation
2. **Built-in laptop speakers** roll off hard above 15 kHz; our chirp at
   17.5–19 kHz arrives 30 dB quieter than test conditions

BlackHole creates a virtual audio cable that bypasses both. Emulator A's
output goes directly into BlackHole, BlackHole feeds emulator B's mic input.
No DAC, no air, no AEC — a pure digital pipe.

## One-time install

```bash
brew install blackhole-2ch
```

(It's a kernel-level driver, so brew will prompt for sudo. If you'd rather,
download the .pkg from https://existential.audio/blackhole/.)

After install, **restart Audio MIDI Setup** for the new device to appear.

## Configure macOS audio routing

1. Open **Audio MIDI Setup** (`/Applications/Utilities/Audio MIDI Setup.app`)
2. Click **+** in the bottom-left → **Create Multi-Output Device**
3. In the right pane, check both:
   - **Built-in Output** (so you can still hear other audio)
   - **BlackHole 2ch**
4. Right-click the new Multi-Output Device → **Use This Device For Sound
   Output**

Now your system audio plays to both your laptop speakers AND BlackHole
simultaneously. The BlackHole feed is what the emulator mic will pick up.

## Configure each Android emulator

For each AVD that needs to receive chirps:

1. Launch the emulator
2. Click the **... (Extended controls)** button on the emulator toolbar
3. Go to **Microphone**
4. Toggle **Virtual microphone uses host audio input** → ON
5. Done — that emulator's mic now sees BlackHole's audio stream

For the emitter emulator: nothing to configure. Its audio output is already
captured by macOS's system output → Multi-Output → BlackHole.

## Quick verification

In a Terminal:

```bash
# Play a test tone through your default output (which is now Multi-Output)
afplay /System/Library/Sounds/Glass.aiff
```

You should hear it through your speakers AND it should be flowing through
BlackHole. If the receiver emulator has mic listening enabled, anything that
plays through the system output will be heard by the emulator's `AudioRecord`.

## Recording the demo

When recording the demo video, use macOS's screen recorder (or QuickTime,
OBS) and screenshot both emulators side-by-side. You can hear the chirp on
your laptop speakers (faintly, at 19 kHz) while seeing the receiver phone
react. To **avoid the chirp on the demo audio track**, record video without
sound and add narration over the top.

## Reverting after the demo

Open Audio MIDI Setup → right-click **Built-in Output** → **Use This Device
For Sound Output** to send audio back to your speakers only.

## What this proves vs. what it doesn't

✓ Proves: the FSK protocol, the audio I/O wiring, the chirp channel, the
  full UX flow all work end-to-end on Android.

✗ Does not prove: that two real phones can chirp through air with their
  actual speakers and mics. For that, you need at least one real phone in
  the loop. (We've simulated it in `fsk.test.ts` and the protocol survives
  the rolloff/noise/echo conditions of a real café — but simulation isn't
  proof.)

The right confidence-building order:

1. Run `npx tsx src/services/audio/fsk.test.ts` → protocol math is correct
2. Two emulators with BlackHole → app integration is correct on Android
3. (Optional) one emulator + one borrowed phone → real-air channel works
4. (Optional) two real phones → production validated

For a hackathon demo video, step 2 is sufficient. Step 3 makes a stronger
submission. Step 4 is post-hackathon.
