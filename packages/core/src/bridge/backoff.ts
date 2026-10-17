export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Fraction of the delay that may be randomly removed (0..1). */
  jitter?: number;
  /** Returns a number in [0, 1). Injectable for tests. */
  random?: () => number;
}

/** Delay before reconnect attempt number `attempt` (0-based). */
export function nextDelay(attempt: number, opts: BackoffOptions = {}): number {
  const {
    baseMs = 500,
    maxMs = 15000,
    jitter = 0.25,
    random = Math.random,
  } = opts;
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(safeAttempt, 30));
  return Math.round(exp * (1 - jitter * random()));
}
