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
const LEVEL_TARGET_SCORE = 30;
const TREBLE_RANGE: [number, number] = [57, 79]; // A3-G5
const BASS_RANGE: [number, number] = [45, 67]; // A2-G4

type LevelId = 1 | 2 | 3;
type VoiceMode = 'auto' | 'treble' | 'bass';
type ResolvedVoiceMode = 'treble' | 'bass';

const LEVELS: Array<{ id: LevelId; title: string; subtitle: string; pitchClasses: number[] }> = [
  { id: 1, title: 'Level 1', subtitle: 'C, D, E', pitchClasses: [0, 2, 4] },
  { id: 2, title: 'Level 2', subtitle: 'C Major scale notes', pitchClasses: [0, 2, 4, 5, 7, 9, 11] },
  { id: 3, title: 'Level 3', subtitle: 'All chromatic notes', pitchClasses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
];

function levelNotesFor(levelId: LevelId) {
  const level = LEVELS.find((entry) => entry.id === levelId);
  if (!level) return notes;
  const allowed = new Set(level.pitchClasses);
  return notes.filter((note) => allowed.has(note.pitchClass));
}

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
  const [levelId, setLevelId] = useState<LevelId>(1);
  const [levelScores, setLevelScores] = useState<Record<LevelId, number>>({ 1: 0, 2: 0, 3: 0 });
  const [autoAdvanceLevels, setAutoAdvanceLevels] = useState(true);
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
  const [noteSuggestion, setNoteSuggestion] = useState<{ index: number; label: string } | null>(null);
  const [bellPulseKey, setBellPulseKey] = useState(0);
  const [bellLoadError, setBellLoadError] = useState(false);

  const levelNotes = useMemo(() => levelNotesFor(levelId), [levelId]);
  const target = levelNotes[targetIndex] ?? levelNotes[0];
  if (!target) {
    return <main className="app">No notes found in notes.json.</main>;
  }

  const trackerRef = useRef<MicrophonePitchTracker | null>(null);
  const timerRef = useRef(new HoldTimer());
  const frameRef = useRef<number | null>(null);
  const visualAnchorMidiRef = useRef<number | null>(null);
  const midiHistoryRef = useRef<Array<{ timeMs: number; midi: number }>>([]);
  const advanceTimeoutRef = useRef<number | null>(null);
  const targetRef = useRef(target);
  const levelIdRef = useRef<LevelId>(levelId);
  const levelNotesRef = useRef(levelNotes);
  const levelScoresRef = useRef(levelScores);
  const autoAdvanceLevelsRef = useRef(autoAdvanceLevels);
  const modeRef = useRef(mode);
  const holdSecondsRef = useRef(holdSeconds);
  const centsToleranceRef = useRef(centsTolerance);
  const voiceModeRef = useRef<VoiceMode>(voiceMode);
  const resolvedVoiceModeRef = useRef<ResolvedVoiceMode>(resolvedVoiceMode);
  const wrongNoteHoldRef = useRef<{ pitchClass: number | null; startedMs: number | null }>({
    pitchClass: null,
    startedMs: null
  });
  const noteSuggestionRef = useRef<{ index: number; label: string } | null>(noteSuggestion);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    levelIdRef.current = levelId;
  }, [levelId]);

  useEffect(() => {
    levelNotesRef.current = levelNotes;
    if (targetIndex >= levelNotes.length) {
      setTargetIndex(0);
    }
  }, [levelNotes, targetIndex]);

  useEffect(() => {
    levelScoresRef.current = levelScores;
  }, [levelScores]);

  useEffect(() => {
    autoAdvanceLevelsRef.current = autoAdvanceLevels;
  }, [autoAdvanceLevels]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    holdSecondsRef.current = holdSeconds;
  }, [holdSeconds]);

  useEffect(() => {
    centsToleranceRef.current = centsTolerance;
  }, [centsTolerance]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    resolvedVoiceModeRef.current = resolvedVoiceMode;
  }, [resolvedVoiceMode]);

  useEffect(() => {
    noteSuggestionRef.current = noteSuggestion;
  }, [noteSuggestion]);

  const resetRoundState = useCallback(() => {
    setSuccess(false);
    setNoteSuggestion(null);
    timerRef.current.reset();
    wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
    visualAnchorMidiRef.current = null;
    midiHistoryRef.current = [];
    trackerRef.current?.resetTracking();
    setProgress(0);
    setElapsedSeconds(0);
  }, []);

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
    resetRoundState();
    setTargetIndex((current) => {
      const pool = levelNotesRef.current;
      if (pool.length <= 1) return 0;
      if (modeRef.current === 'sequential') {
        return (current + 1) % pool.length;
      }
      return randomIndex(pool.length, current);
    });
  }, [resetRoundState]);

  const switchToSuggestedNote = useCallback((index: number) => {
    setTargetIndex(index);
    resetRoundState();
  }, [resetRoundState]);

  const scheduleAdvanceAfterSuccess = useCallback(() => {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }

    advanceTimeoutRef.current = window.setTimeout(() => {
      const currentLevel = levelIdRef.current;
      const currentScores = levelScoresRef.current;
      const currentScore = currentScores[currentLevel];
      const nextScore = Math.min(LEVEL_TARGET_SCORE, currentScore + 1);
      const updatedScores = { ...currentScores, [currentLevel]: nextScore } as Record<LevelId, number>;
      levelScoresRef.current = updatedScores;
      setLevelScores(updatedScores);

      const justCompletedLevel = currentScore < LEVEL_TARGET_SCORE && nextScore >= LEVEL_TARGET_SCORE;
      const canAutoAdvance = autoAdvanceLevelsRef.current && currentLevel < 3;

      if (justCompletedLevel && canAutoAdvance) {
        const nextLevel = (currentLevel + 1) as LevelId;
        setLevelId(nextLevel);
        levelIdRef.current = nextLevel;
        setTargetIndex(0);
        setStatusText(`Level ${currentLevel} complete. Welcome to Level ${nextLevel}!`);
        resetRoundState();
        return;
      }

      if (justCompletedLevel && currentLevel === 3) {
        setStatusText('Level 3 complete!');
      }

      if (justCompletedLevel && !canAutoAdvance && currentLevel < 3) {
        setStatusText(`Level ${currentLevel} complete. Select Level ${currentLevel + 1} when ready.`);
      }

      resetRoundState();
      setTargetIndex((current) => {
        const pool = levelNotesRef.current;
        if (pool.length <= 1) return 0;
        if (modeRef.current === 'sequential') {
          return (current + 1) % pool.length;
        }
        return randomIndex(pool.length, current);
      });
    }, 700);
  }, [resetRoundState]);

  const stepPitchUi = useCallback(() => {
    const liveTarget = targetRef.current;
    if (!trackerRef.current || !liveTarget) {
      return;
    }

    const frame = trackerRef.current.getSmoothedFrame(liveTarget.pitchClass);
    const nowMs = performance.now();

    if (frame.status === 'too_quiet') {
      setStatusText('Too quiet');
      setLineOffsetCents(0);
      setMicLevel(frame.rms);
      setInTune(false);
      setHasPitch(false);
      setGuidance(null);
      const hold = timerRef.current.update(false, nowMs, holdSecondsRef.current * 1000);
      setProgress(hold.progress);
      setElapsedSeconds(0);
      wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
    } else if (frame.status === 'no_pitch' || frame.status === 'low_confidence' || frame.frequencyHz === null) {
      setStatusText('No pitch detected');
      setLineOffsetCents(0);
      setMicLevel(frame.rms);
      setInTune(false);
      setHasPitch(false);
      setGuidance(null);
      const hold = timerRef.current.update(false, nowMs, holdSecondsRef.current * 1000);
      setProgress(hold.progress);
      setElapsedSeconds(0);
      wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
    } else {
      const cents = frame.centsFromTarget ?? 0;
      setMicLevel(frame.rms);
      setHasPitch(true);

      if (frame.midi !== null) {
        midiHistoryRef.current.push({ timeMs: nowMs, midi: frame.midi });
        midiHistoryRef.current = midiHistoryRef.current.filter((item) => nowMs - item.timeMs <= 2500);
      }

      let effectiveVoice: ResolvedVoiceMode = resolvedVoiceModeRef.current;
      if (voiceModeRef.current === 'auto') {
        const mids = midiHistoryRef.current.map((item) => item.midi);
        if (mids.length >= 8) {
          const med = median(mids);
          effectiveVoice = med >= 62 ? 'treble' : 'bass';
          if (effectiveVoice !== resolvedVoiceModeRef.current) {
            setResolvedVoiceMode(effectiveVoice);
            resolvedVoiceModeRef.current = effectiveVoice;
            visualAnchorMidiRef.current = null;
          }
        }
      } else {
        effectiveVoice = voiceModeRef.current;
        if (effectiveVoice !== resolvedVoiceModeRef.current) {
          setResolvedVoiceMode(effectiveVoice);
          resolvedVoiceModeRef.current = effectiveVoice;
          visualAnchorMidiRef.current = null;
        }
      }

      const [minMidi, maxMidi] = effectiveVoice === 'treble' ? TREBLE_RANGE : BASS_RANGE;
      const candidates = getPitchClassCandidates(liveTarget.pitchClass, minMidi, maxMidi);
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

      const matchedClass = frame.pitchClass !== null && matchesPitchClass(frame.pitchClass, liveTarget.pitchClass);
      const currentlyInTune = matchedClass && Math.abs(cents) <= centsToleranceRef.current;
      setInTune(currentlyInTune);

      const hold = timerRef.current.update(currentlyInTune, nowMs, holdSecondsRef.current * 1000);
      setProgress(hold.progress);
      setElapsedSeconds(hold.elapsedMs / 1000);
      setSuccess(hold.success);

      if (hold.justSucceeded) {
        setGuidance(null);
        setStatusText('Success! +1 point');
        scheduleAdvanceAfterSuccess();
      } else if (currentlyInTune) {
        setGuidance(null);
        wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
        setStatusText(`Hold it... ${(holdSecondsRef.current - hold.elapsedMs / 1000).toFixed(1)}s`);
      } else if (frame.pitchClass !== null && !matchedClass) {
        setGuidance(null);
        setStatusText(`Detected ${pitchClassToLabel(frame.pitchClass)}. Target is ${liveTarget.label}.`);

        const wrongHold = wrongNoteHoldRef.current;
        if (wrongHold.pitchClass !== frame.pitchClass) {
          wrongNoteHoldRef.current = { pitchClass: frame.pitchClass, startedMs: nowMs };
        } else if (
          wrongHold.startedMs !== null &&
          nowMs - wrongHold.startedMs >= 3500 &&
          noteSuggestionRef.current === null
        ) {
          const suggestionIndex = levelNotesRef.current.findIndex((note) => note.pitchClass === frame.pitchClass);
          if (suggestionIndex >= 0) {
            setNoteSuggestion({ index: suggestionIndex, label: levelNotesRef.current[suggestionIndex].label });
          }
          wrongNoteHoldRef.current = { pitchClass: frame.pitchClass, startedMs: nowMs + 100000 };
        }
      } else if (Math.abs(cents) > DISPLAY_RANGE_CENTS) {
        const nextGuidance: 'higher' | 'lower' = cents > 0 ? 'lower' : 'higher';
        setGuidance(nextGuidance);
        setStatusText(`Outside range: sing ${nextGuidance}`);
        wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
      } else {
        setGuidance(null);
        setStatusText('Listening...');
        wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
      }
    }

    frameRef.current = requestAnimationFrame(stepPitchUi);
  }, [scheduleAdvanceAfterSuccess]);

  const startMic = useCallback(async () => {
    try {
      if (!trackerRef.current) {
        trackerRef.current = new MicrophonePitchTracker();
      }
      timerRef.current.reset();
      wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
      setNoteSuggestion(null);
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
    wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
    setNoteSuggestion(null);
    visualAnchorMidiRef.current = null;
    midiHistoryRef.current = [];
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }
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
      if (advanceTimeoutRef.current !== null) {
        window.clearTimeout(advanceTimeoutRef.current);
      }
      trackerRef.current?.stop();
      audioRef.current?.pause();
    };
  }, []);

  const allLevelsComplete = levelScores[3] >= LEVEL_TARGET_SCORE;
  const currentLevelConfig = LEVELS.find((entry) => entry.id === levelId) ?? LEVELS[0];

  const appStyle = useMemo(() => ({ '--target-color': target.hex } as CSSProperties), [target.hex]);

  return (
    <main className="app" style={appStyle}>
      <header>
        <h1>Prodigies Pitch Recall Trainer</h1>
      </header>

      <section className="levels-panel">
        <div className="levels-top">
          <h2>Challenge Levels</h2>
          <label className="auto-advance-toggle">
            <input
              type="checkbox"
              checked={autoAdvanceLevels}
              onChange={(event) => setAutoAdvanceLevels(event.target.checked)}
            />
            Auto-advance levels at {LEVEL_TARGET_SCORE} points
          </label>
        </div>
        <div className="levels-grid">
          {LEVELS.map((level) => (
            <button
              key={level.id}
              className={`level-card ${level.id === levelId ? 'active' : ''}`}
              onClick={() => {
                setLevelId(level.id);
                levelIdRef.current = level.id;
                setTargetIndex(0);
                resetRoundState();
                setStatusText(`Switched to ${level.title}.`);
              }}
            >
              <strong>{level.title}</strong>
              <span>{level.subtitle}</span>
              <span>
                Score: {levelScores[level.id]} / {LEVEL_TARGET_SCORE}
              </span>
            </button>
          ))}
        </div>
        <p className="current-level-meta">
          Playing {currentLevelConfig.title}: {currentLevelConfig.subtitle} ({levelScores[levelId]} / {LEVEL_TARGET_SCORE}
          )
        </p>
      </section>

      {allLevelsComplete && (
        <section className="completion-banner">
          Congratulations! You've passed all three levels and are on your way to a lifetime of singing in tune!
        </section>
      )}

      <TargetPanel
        note={target}
        mode={mode}
        onModeChange={(nextMode) => {
          setMode(nextMode);
          modeRef.current = nextMode;
        }}
        onNextNote={gotoNextNote}
        onReplay={playTargetSample}
        bellPulseKey={bellPulseKey}
        bellLoadError={bellLoadError}
        onBellLoadError={() => {
          setBellLoadError(true);
          console.warn(`Missing bell image: ${normalizeAssetPath(target.bellPng)}`);
        }}
      />

      {noteSuggestion && (
        <section className="note-suggestion">
          <p>Would you like to practice {noteSuggestion.label}?</p>
          <div className="note-suggestion-actions">
            <button onClick={() => switchToSuggestedNote(noteSuggestion.index)}>Switch Note</button>
            <button onClick={() => setNoteSuggestion(null)}>Not now</button>
          </div>
        </section>
      )}

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
            resolvedVoiceModeRef.current = mode;
          }
          visualAnchorMidiRef.current = null;
          midiHistoryRef.current = [];
          wrongNoteHoldRef.current = { pitchClass: null, startedMs: null };
          setNoteSuggestion(null);
          trackerRef.current?.resetTracking();
        }}
      />
    </main>
  );
}
