import type { Projector } from "./sync-plan.js";

/** Metadata key used by the Stat Bubbles for D&D extension. */
export const STAT_BUBBLES_METADATA_KEY =
  "com.owlbear-rodeo-bubbles-extension/metadata";

/** The token's current stat bubbles value as an object; anything else counts as absent. */
function currentFields(current: unknown): Record<string, unknown> {
  return typeof current === "object" &&
    current !== null &&
    !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {};
}

/**
 * Writes the instance's HP, max HP and armor class for the Stat Bubbles
 * extension, hidden from players unless the GM changed `hide` at the table.
 * The token's other fields (temporary health, `name`, ...) are carried over,
 * and so is its armor class when the instance has none.
 */
export const statBubblesProjector: Projector = {
  key: STAT_BUBBLES_METADATA_KEY,
  mode: "owned",
  project: (instance, current) => {
    const fields = currentFields(current);
    return {
      ...fields,
      health: instance.currentHp,
      "max health": instance.maxHp,
      ...(typeof instance.armorClass === "number"
        ? { "armor class": instance.armorClass }
        : {}),
      hide: typeof fields.hide === "boolean" ? fields.hide : true,
    };
  },
  invert: () => {
    throw new Error("not implemented");
  },
};
