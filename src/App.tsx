import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MicPanel } from './components/MicPanel';
import { Settings } from './components/Settings';
import { TargetPanel } from './components/TargetPanel';
import { MicrophonePitchTracker } from './audio/microphoneTracker';
import { matchesPitchClass, pitchClassToLabel } from './audio/pitchMath';
import { HoldTimer } from './game/holdTimer';
import { notes, normalizeAssetPath } from './data/notes';

const DISPLAY_RANGE_CENTS = 600;
const DEFAULT_HOLD_SECONDS = 5;
const DEFAULT_CENTS_TOLERANCE = 35;
const TREBLE_RANGE: [number, number] = [57, 79]; // A3-G5
const BASS_RANGE: [number, number] = [45, 67]; // A2-G4

type VoiceMode = 'auto' | 'treble' | 'bass';
type ResolvedVoiceMode = 'treble' | 'bass';

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getPitchClassCandidates(pitchClass: number, minMidi: number, maxMidi: number): number[] {
  const list: number[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    if ((((midi % 12) + 12) % 12) === pitchClass) {
      list.push(midi);
    }
  }
  return list;
}

function closestCandidate(detectedMidi: number, candidates: number[]): number {
  if (!candidates.length) return Math.round(detectedMidi);
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - detectedMidi) < Math.abs(best - detectedMidi) ? candidate : best
  );
}

function randomIndex(max: number, except: number): number {
  if (max <= 1) return 0;
  let index = except;
  while (index === except) {
    index = Math.floor(Math.random() * max);
  }
  return index;
}

export default function App() {
  const [targetIndex, setTargetIndex] = useState(0);
  const [mode, setMode] = useState<'random' | 'sequential'>('random');
  const [holdSeconds, setHoldSeconds] = useState(DEFAULT_HOLD_SECONDS);
  const [centsTolerance, setCentsTolerance] = useState(DEFAULT_CENTS_TOLERANCE);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('auto');
  const [resolvedVoiceMode, setResolvedVoiceMode] = useState<ResolvedVoiceMode>('treble');
  const [micRunning, setMicRunning] = useState(false);
  const [statusText, setStatusText] = useState('Press Start Mic to begin.');
  const [lineOffsetCents, setLineOffsetCents] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [inTune, setInTune] = useState(false);
  const [hasPitch, setHasPitch] = useState(false);
  const [guidance, setGuidance] = useState<'higher' | 'lower' | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [success, setSuccess] = useState(false);
  const [bellPulseKey, setBellPulseKey] = useState(0);
  const [bellLoadError, setBellLoadError] = useState(false);

  const target = notes[targetIndex];
  if (!target) {
    return <main className="app">No notes found in notes.json.</main>;
  }

  const trackerRef = useRef<MicrophonePitchTracker | null>(null);
  const timerRef = useRef(new HoldTimer());
  const frameRef = useRef<number | null>(null);
  const visualAnchorMidiRef = useRef<number | null>(null);
  const midiHistoryRef = useRef<Array<{ timeMs: number; midi: number }>>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playTargetSample = useCallback(() => {
    if (!target) return;

    const path = normalizeAssetPath(target.sampleMp3);
    const audio = new Audio(path);
    audioRef.current = audio;
    audio.currentTime = 0;

    void audio.play().catch((error: unknown) => {
      console.warn(`Could not autoplay sample ${path}. User gesture may be required.`, error);
    });

    setBellPulseKey((value) => value + 1);
  }, [target]);

  const gotoNextNote = useCallback(() => {
    setSuccess(false);
    timerRef.current.reset();
    visualAnchorMidiRef.current = null;
    midiHistoryRef.current = [];
    setProgress(0);
    setElapsedSeconds(0);

    setTargetIndex((current) => {
      if (mode === 'sequential') {
        return (current + 1) % notes.length;
      }
      return randomIndex(notes.length, current);
    });
  }, [mode]);

  const stepPitchUi = useCallback(() => {
    if (!trackerRef.current || !target) {
      return;
    }

    const frame = trackerRef.current.getSmoothedFrame(target.pitchClass);

    if (frame.status === 'too_quiet') {
      setStatusText('Too quiet');
      setLineOffsetCents(0);
      setMicLevel(frame.rms);
      setInTune(false);
      setHasPitch(false);
      setGuidance(null);
      const hold = timerRef.current.update(false, performance.now(), holdSeconds * 1000);
      setProgress(hold.progress);
      setElapsedSeconds(0);
    } else if (frame.status === 'no_pitch' || frame.status === 'low_confidence' || frame.frequencyHz === null) {
      setStatusText('No pitch detected');
      setLineOffsetCents(0);
      setMicLevel(frame.rms);
      setInTune(false);
      setHasPitch(false);
      setGuidance(null);
      const hold = timerRef.current.update(false, performance.now(), holdSeconds * 1000);
      setProgress(hold.progress);
      setElapsedSeconds(0);
    } else {
      const cents = frame.centsFromTarget ?? 0;
      setMicLevel(frame.rms);
      setHasPitch(true);

      const nowMs = performance.now();
      if (frame.midi !== null) {
        midiHistoryRef.current.push({ timeMs: nowMs, midi: frame.midi });
        midiHistoryRef.current = midiHistoryRef.current.filter((item) => nowMs - item.timeMs <= 2500);
      }

      let effectiveVoice: ResolvedVoiceMode = resolvedVoiceMode;
      if (voiceMode === 'auto') {
        const mids = midiHistoryRef.current.map((item) => item.midi);
        if (mids.length >= 8) {
          const med = median(mids);
          effectiveVoice = med >= 62 ? 'treble' : 'bass';
          if (effectiveVoice !== resolvedVoiceMode) {
            setResolvedVoiceMode(effectiveVoice);
            visualAnchorMidiRef.current = null;
          }
        }
      } else {
        effectiveVoice = voiceMode;
        if (effectiveVoice !== resolvedVoiceMode) {
          setResolvedVoiceMode(effectiveVoice);
          visualAnchorMidiRef.current = null;
        }
      }

      const [minMidi, maxMidi] = effectiveVoice === 'treble' ? TREBLE_RANGE : BASS_RANGE;
      const candidates = getPitchClassCandidates(target.pitchClass, minMidi, maxMidi);
      const detectedMidi = frame.midi ?? 0;
      const bestCandidate = closestCandidate(detectedMidi, candidates);
      const currentAnchor = visualAnchorMidiRef.current;
      const hysteresisCents = 280;

      if (currentAnchor === null || !candidates.includes(currentAnchor)) {
        visualAnchorMidiRef.current = bestCandidate;
      } else if (bestCandidate !== currentAnchor) {
        const currentDistance = Math.abs((detectedMidi - currentAnchor) * 100);
        const bestDistance = Math.abs((detectedMidi - bestCandidate) * 100);
        if (bestDistance + hysteresisCents < currentDistance) {
          visualAnchorMidiRef.current = bestCandidate;
        }
      }

      const anchorMidi = visualAnchorMidiRef.current ?? bestCandidate;
      const visualCents = (detectedMidi - anchorMidi) * 100;
      setLineOffsetCents(visualCents);

      const matchedClass = frame.pitchClass !== null && matchesPitchClass(frame.pitchClass, target.pitchClass);
      const currentlyInTune = matchedClass && Math.abs(cents) <= centsTolerance;
      setInTune(currentlyInTune);

      const hold = timerRef.current.update(currentlyInTune, performance.now(), holdSeconds * 1000);
      setProgress(hold.progress);
      setElapsedSeconds(hold.elapsedMs / 1000);
      setSuccess(hold.success);

      if (hold.justSucceeded) {
        setGuidance(null);
        setStatusText('Success!');
      } else if (currentlyInTune) {
        setGuidance(null);
        setStatusText(`Hold it... ${(holdSeconds - hold.elapsedMs / 1000).toFixed(1)}s`);
      } else if (frame.pitchClass !== null && !matchedClass) {
        setGuidance(null);
        setStatusText(`Detected ${pitchClassToLabel(frame.pitchClass)}. Target is ${target.label}.`);
      } else if (Math.abs(cents) > DISPLAY_RANGE_CENTS) {
        const nextGuidance: 'higher' | 'lower' = cents > 0 ? 'lower' : 'higher';
        setGuidance(nextGuidance);
        setStatusText(`Outside range: sing ${nextGuidance}`);
      } else {
        setGuidance(null);
        setStatusText('Listening...');
      }
    }

    frameRef.current = requestAnimationFrame(stepPitchUi);
  }, [centsTolerance, holdSeconds, target]);

  const startMic = useCallback(async () => {
    try {
      if (!trackerRef.current) {
        trackerRef.current = new MicrophonePitchTracker();
      }
      timerRef.current.reset();
      setSuccess(false);

      await trackerRef.current.start();
      setMicRunning(true);
      setStatusText('Listening...');

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = requestAnimationFrame(stepPitchUi);
    } catch (error) {
      console.error('Microphone failed to start', error);
      setStatusText('Mic permission denied or unavailable.');
      setMicRunning(false);
    }
  }, [stepPitchUi]);

  const stopMic = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    trackerRef.current?.stop();
    setMicRunning(false);
    setStatusText('Mic stopped.');
    setLineOffsetCents(0);
    setMicLevel(0);
    setInTune(false);
    setHasPitch(false);
    setGuidance(null);
    setProgress(0);
    setElapsedSeconds(0);
    timerRef.current.reset();
    visualAnchorMidiRef.current = null;
    midiHistoryRef.current = [];
  }, []);

  const toggleMic = useCallback(() => {
    if (micRunning) {
      stopMic();
      return;
    }
    void startMic();
  }, [micRunning, startMic, stopMic]);

  useEffect(() => {
    if (!target) return;
    setBellLoadError(false);
    playTargetSample();
  }, [target, playTargetSample]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      trackerRef.current?.stop();
      audioRef.current?.pause();
    };
  }, []);

  const appStyle = useMemo(() => ({ '--target-color': target.hex } as CSSProperties), [target.hex]);

  return (
    <main className="app" style={appStyle}>
      <header>
        <h1>Prodigies Pitch Recall Trainer</h1>
      </header>

      <TargetPanel
        note={target}
        mode={mode}
        onModeChange={setMode}
        onNextNote={gotoNextNote}
        onReplay={playTargetSample}
        bellPulseKey={bellPulseKey}
        bellLoadError={bellLoadError}
        onBellLoadError={() => {
          setBellLoadError(true);
          console.warn(`Missing bell image: ${normalizeAssetPath(target.bellPng)}`);
        }}
      />

      <MicPanel
        micRunning={micRunning}
        lineOffsetCents={lineOffsetCents}
        micLevel={micLevel}
        displayRangeCents={DISPLAY_RANGE_CENTS}
        targetHex={target.hex}
        inTune={inTune}
        hasPitch={hasPitch}
        guidance={guidance}
        statusText={success ? 'Success!' : statusText}
        progress={progress}
        holdSeconds={holdSeconds}
        elapsedSeconds={elapsedSeconds}
        success={success}
        onToggleMic={toggleMic}
      />

      <Settings
        holdSeconds={holdSeconds}
        centsTolerance={centsTolerance}
        voiceMode={voiceMode}
        resolvedVoiceMode={resolvedVoiceMode}
        onHoldSecondsChange={(value) => setHoldSeconds(Number.isFinite(value) ? Math.max(1, value) : 5)}
        onCentsToleranceChange={(value) =>
          setCentsTolerance(Number.isFinite(value) ? Math.min(80, Math.max(10, value)) : DEFAULT_CENTS_TOLERANCE)
        }
        onVoiceModeChange={(mode) => {
          setVoiceMode(mode);
          if (mode !== 'auto') {
            setResolvedVoiceMode(mode);
          }
          visualAnchorMidiRef.current = null;
          midiHistoryRef.current = [];
        }}
      />
    </main>
  );
}
