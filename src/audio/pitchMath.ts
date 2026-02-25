export interface PitchStats {
  midi: number;
  roundedMidi: number;
  pitchClass: number;
  centsFromRoundedMidi: number;
}

const PITCH_CLASS_LABELS = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'] as const;

export function hzToMidi(frequencyHz: number): number {
  return 69 + 12 * Math.log2(frequencyHz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToPitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function analyzePitch(frequencyHz: number): PitchStats {
  const midi = hzToMidi(frequencyHz);
  const roundedMidi = Math.round(midi);
  const pitchClass = ((roundedMidi % 12) + 12) % 12;
  const centsFromRoundedMidi = (midi - roundedMidi) * 100;

  return { midi, roundedMidi, pitchClass, centsFromRoundedMidi };
}

export function nearestTargetMidi(detectedMidi: number, targetPitchClass: number): number {
  const rounded = Math.round(detectedMidi);
  const roundedPc = ((rounded % 12) + 12) % 12;

  let diff = targetPitchClass - roundedPc;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;

  return rounded + diff;
}

export function centsFromNearestTarget(detectedMidi: number, targetPitchClass: number): number {
  return (detectedMidi - nearestTargetMidi(detectedMidi, targetPitchClass)) * 100;
}

export function matchesPitchClass(detectedPitchClass: number, targetPitchClass: number): boolean {
  return ((detectedPitchClass % 12) + 12) % 12 === ((targetPitchClass % 12) + 12) % 12;
}

export function pitchClassToLabel(pitchClass: number): string {
  return PITCH_CLASS_LABELS[((pitchClass % 12) + 12) % 12];
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
