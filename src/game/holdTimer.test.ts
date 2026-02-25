import { HoldTimer } from './holdTimer';

describe('HoldTimer', () => {
  it('requires continuous in-tune duration', () => {
    const timer = new HoldTimer();
    const requiredMs = 5000;

    let state = timer.update(true, 1000, requiredMs);
    expect(state.progress).toBe(0);
    expect(state.success).toBe(false);

    state = timer.update(true, 4500, requiredMs);
    expect(state.success).toBe(false);

    state = timer.update(false, 4600, requiredMs);
    expect(state.progress).toBe(0);
    expect(state.success).toBe(false);

    state = timer.update(true, 4700, requiredMs);
    expect(state.progress).toBe(0);

    state = timer.update(true, 9800, requiredMs);
    expect(state.success).toBe(true);
    expect(state.justSucceeded).toBe(true);
  });

  it('does not repeatedly emit justSucceeded after success', () => {
    const timer = new HoldTimer();

    timer.update(true, 0, 1000);
    let state = timer.update(true, 1000, 1000);
    expect(state.justSucceeded).toBe(true);

    state = timer.update(true, 1300, 1000);
    expect(state.success).toBe(true);
    expect(state.justSucceeded).toBe(false);
  });
});
