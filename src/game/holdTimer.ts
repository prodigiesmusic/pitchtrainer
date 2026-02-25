export interface HoldProgress {
  progress: number;
  elapsedMs: number;
  success: boolean;
  justSucceeded: boolean;
}

export class HoldTimer {
  private startMs: number | null = null;
  private success = false;

  reset() {
    this.startMs = null;
    this.success = false;
  }

  update(inTune: boolean, nowMs: number, requiredMs: number): HoldProgress {
    if (!inTune) {
      this.reset();
      return {
        progress: 0,
        elapsedMs: 0,
        success: false,
        justSucceeded: false
      };
    }

    if (this.startMs === null) {
      this.startMs = nowMs;
    }

    const elapsedMs = Math.max(0, nowMs - this.startMs);
    const progress = Math.min(1, elapsedMs / requiredMs);

    let justSucceeded = false;
    if (!this.success && elapsedMs >= requiredMs) {
      this.success = true;
      justSucceeded = true;
    }

    return {
      progress,
      elapsedMs,
      success: this.success,
      justSucceeded
    };
  }
}
