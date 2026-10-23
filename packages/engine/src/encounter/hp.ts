import { InvalidAmountError, InvalidArmorClassError } from "./errors.js";

/**
 * Validates an absolute current HP value and clamps it to 0..maxHp. Throws
 * InvalidAmountError if `hp` is not an integer.
 */
export function clampHp(hp: number, maxHp: number): number {
  if (!Number.isInteger(hp)) {
    throw new InvalidAmountError(`hp must be an integer, got ${String(hp)}`);
  }
  return Math.min(maxHp, Math.max(0, hp));
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
  if (!Number.isInteger(newMaxHp)) {
    throw new InvalidAmountError(
      `maxHp must be an integer, got ${String(newMaxHp)}`,
    );
  }
  const maxHp = Math.max(1, newMaxHp);
  return { maxHp, currentHp: Math.min(currentHp, maxHp) };
}

/**
 * Validates an armor class and raises a negative value to 0. Throws
 * InvalidArmorClassError if `armorClass` is not an integer.
 */
export function clampArmorClass(armorClass: number): number {
  if (!Number.isInteger(armorClass)) {
    throw new InvalidArmorClassError(
      `armor class must be an integer, got ${String(armorClass)}`,
    );
  }
  return Math.max(0, armorClass);
}
