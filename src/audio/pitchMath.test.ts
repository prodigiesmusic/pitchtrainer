import {
  centsFromNearestTarget,
  hzToMidi,
  matchesPitchClass,
  midiToHz,
  midiToPitchClass
} from './pitchMath';

describe('pitchMath', () => {
  it('converts A4 correctly between Hz and MIDI', () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 5);
    expect(midiToHz(69)).toBeCloseTo(440, 5);
  });

  it('maps MIDI to pitch class', () => {
    expect(midiToPitchClass(60)).toBe(0); // C
    expect(midiToPitchClass(69)).toBe(9); // A
  });

  it('matches pitch class modulo 12', () => {
    expect(matchesPitchClass(0, 12)).toBe(true);
    expect(matchesPitchClass(11, -1)).toBe(true);
    expect(matchesPitchClass(4, 5)).toBe(false);
  });

  it('computes cents from nearest target in any octave', () => {
    const midiNearA = 57.1; // ~A3 + 10 cents
    const cents = centsFromNearestTarget(midiNearA, 9);
    expect(cents).toBeCloseTo(10, 0);
  });
});
