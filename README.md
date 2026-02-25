# Prodigies Pitch Recall Trainer (Prototype)

Browser-only React + Vite prototype for pitch recall / live voice tuning.

## What it does

- Loads note definitions from `notes.json` (single source of truth)
- Shows target note label, bell image, and plays bell sample
- Supports `Sequential` and `Random` note modes
- Mic Start/Stop with permission requested only on user gesture
- Real-time pitch tracking (Web Audio + autocorrelation, no recording)
- Any-octave target matching by pitch class
- In-tune detection using pitch class + cents tolerance
- Scrolling pitch trail visualization ("snake") with ±6 semitone vertical range
- Out-of-range guidance (`sing higher` / `sing lower`) when outside ±6 semitones
- Faster display smoothing (~150ms) for lower visual latency
- Snake thickness reacts to mic amplitude (thin in silence, thicker with stronger signal)
- 1px center spine line drawn through the snake path
- Explicit wrong-note feedback (`Detected X. Target is Y.`)
- Voice range mode selector: `Auto`, `Treble (A3-G5)`, `Bass (A2-G4)`
- Auto mode infers likely range from early sung MIDI and keeps the visual octave anchor stable to avoid octave-jump flicker during glides
- Continuous hold timer (resets when out of tune)
- Success reward banner + simple confetti effect
- Graceful image/audio fallback with console warnings if assets are missing

## Project structure

- `src/audio/`: pitch math, autocorrelation detector, microphone tracker
- `src/game/`: hold timer state machine
- `src/components/`: `TargetPanel`, `MicPanel`, `Settings`
- `src/data/`: notes import + path helpers

## Run locally

1. Install Node.js 20+ (includes npm).
2. Install dependencies:

```bash
npm install
```

3. Start dev server:

```bash
npm run dev
```

4. Open the Vite URL in Chrome (desktop) or mobile Safari/Chrome on same network.

## Run tests

```bash
npm run test
```

## Notes

- No PWA/service worker/offline setup is included yet by design.
- `notes.json` is imported from project root and drives pitch class, color, image path, and sample path.
- Bell/sample assets are served from `public/bells` and `public/samples` matching paths declared in `notes.json`.
