/** Source of randomness injected into dice rolls. Core never uses Math.random. */
export interface Rng {
  /** Returns an integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}
