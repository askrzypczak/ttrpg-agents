/** Source of randomness injected into dice rolls. Core never uses Math.random. */
export interface Rng {
  /** Returns an integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** Deterministic seedable RNG (mulberry32). Same seed yields the same sequence. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  const nextUnit = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nextInt(maxExclusive: number): number {
      return Math.floor(nextUnit() * maxExclusive);
    },
  };
}
