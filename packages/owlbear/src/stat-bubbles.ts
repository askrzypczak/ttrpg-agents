import type { InstanceEdit } from "@ttrpg-agents/engine";
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
 * extension. `hide` follows the instance's `statsVisible` (hidden unless
 * revealed); a GM edit of `hide` at the table wins until the encounter changes
 * the instance's `statsVisible`.
 * The token's other fields (temporary health, `name`, ...) are carried over,
 * and so is its armor class when the instance has none.
 */
export const statBubblesProjector: Projector = {
  key: STAT_BUBBLES_METADATA_KEY,
  mode: "owned",
  project: (instance, current, baseline) => {
    const fields = currentFields(current);
    const raw = !instance.statsVisible;
    // Without a baseline the planner keeps the token's value anyway.
    const encounterChanged =
      baseline !== undefined && currentFields(baseline).hide !== raw;
    const hide =
      !encounterChanged && typeof fields.hide === "boolean" ? fields.hide : raw;
    return {
      ...fields,
      health: instance.currentHp,
      "max health": instance.maxHp,
      ...(typeof instance.armorClass === "number"
        ? { "armor class": instance.armorClass }
        : {}),
      hide,
    };
  },
  editFields: {
    currentHp: "health",
    maxHp: "max health",
    armorClass: "armor class",
  },
  readBack: (value, instance) => {
    const fields = currentFields(value);
    const edit: Omit<InstanceEdit, "instanceId"> = {};
    const invalid: string[] = [];
    const read = (
      key: string,
      stored: number | null | undefined,
      set: (n: number) => void,
    ): void => {
      if (typeof stored !== "number" || !Object.hasOwn(fields, key)) return;
      const edited = fields[key];
      // Stryker disable next-line ConditionalExpression: equivalent, `Number.isInteger` is already false for a non-number
      if (typeof edited !== "number" || !Number.isInteger(edited))
        invalid.push(key);
      else if (edited !== stored) set(edited);
    };
    read("health", instance.currentHp, (n) => (edit.currentHp = n));
    read("max health", instance.maxHp, (n) => (edit.maxHp = n));
    read("armor class", instance.armorClass, (n) => (edit.armorClass = n));
    return { edit, invalid };
  },
};
