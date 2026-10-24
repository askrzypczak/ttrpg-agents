import type { Projector } from "./sync-plan.js";

/** Metadata key used by the Stat Bubbles for D&D extension. */
export const STAT_BUBBLES_METADATA_KEY =
  "com.owlbear-rodeo-bubbles-extension/metadata";

/**
 * Writes the instance's HP, max HP and armor class for the Stat Bubbles
 * extension, hidden from players unless the GM changed `hide` at the table.
 */
export const statBubblesProjector: Projector = {
  key: STAT_BUBBLES_METADATA_KEY,
  mode: "owned",
  project: () => {
    throw new Error("not implemented");
  },
};
