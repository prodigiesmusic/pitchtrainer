export interface AutocorrelationResult {
  frequencyHz: number | null;
  clarity: number;
}

export function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const v = buffer[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}

export function detectPitchAutocorrelation(
  buffer: Float32Array,
  sampleRate: number,
  minHz = 70,
  maxHz = 900
): AutocorrelationResult {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  if (maxLag <= minLag || buffer.length <= maxLag + 2) {
    return { frequencyHz: null, clarity: 0 };
  }

  // YIN-style difference function and cumulative mean normalized difference.
  const differences = new Float32Array(maxLag + 2);
  const cmnd = new Float32Array(maxLag + 2);
  cmnd[0] = 1;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    const upper = buffer.length - lag;
    for (let i = 0; i < upper; i += 1) {
      const delta = buffer[i] - buffer[i + lag];
      sum += delta * delta;
    }
    differences[lag] = sum;
  }

  let running = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    running += differences[lag];
    cmnd[lag] = running > 0 ? (differences[lag] * lag) / running : 1;
  }

  let bestLag = -1;
  let bestCmnd = 1;
  const threshold = 0.12;

  for (let lag = minLag + 1; lag < maxLag - 1; lag += 1) {
    const value = cmnd[lag];
    if (value < bestCmnd) {
      bestCmnd = value;
      bestLag = lag;
    }

    if (value < threshold && value <= cmnd[lag - 1] && value <= cmnd[lag + 1]) {
      bestLag = lag;
      bestCmnd = value;
      break;
    }
  }

  if (bestLag < 0) {
    return { frequencyHz: null, clarity: 0 };
  }

  const left = cmnd[bestLag - 1] ?? cmnd[bestLag];
  const center = cmnd[bestLag];
  const right = cmnd[bestLag + 1] ?? cmnd[bestLag];

  const denominator = left - 2 * center + right;
  const shift = denominator === 0 ? 0 : 0.5 * (left - right) / denominator;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, shift));

  const frequencyHz = refinedLag > 0 ? sampleRate / refinedLag : null;
  const clarity = Math.max(0, Math.min(1, 1 - bestCmnd));

  if (!frequencyHz || !Number.isFinite(frequencyHz)) {
    return { frequencyHz: null, clarity: 0 };
  }

  return { frequencyHz, clarity };
}
