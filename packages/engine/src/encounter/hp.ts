/**
 * Validates an absolute current HP value and clamps it to 0..maxHp. Throws
 * InvalidAmountError if `hp` is not an integer.
 */
export function clampHp(hp: number, maxHp: number): number {
  void [hp, maxHp];
  throw new Error("not implemented");
}

/**
 * Validates a new max HP (raised to at least 1) and returns it with the
 * current HP, lowered to the new max if above it (never raised). Throws
 * InvalidAmountError if `newMaxHp` is not an integer.
 */
export function resizeMaxHp(
  currentHp: number,
  newMaxHp: number,
): { maxHp: number; currentHp: number } {
  void [currentHp, newMaxHp];
  throw new Error("not implemented");
}

/**
 * Validates an armor class and raises a negative value to 0. Throws
 * InvalidArmorClassError if `armorClass` is not an integer.
 */
export function clampArmorClass(armorClass: number): number {
  void armorClass;
  throw new Error("not implemented");
}
