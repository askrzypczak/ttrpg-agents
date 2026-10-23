import type { Projector } from "./sync-plan.js";

/** Metadata key used by the Owlbear Initiative Tracker extension. */
export const INITIATIVE_METADATA_KEY =
  "rodeo.owlbear.initiative-tracker/metadata";

/** Whether the tracker's current value on the token marks it as the active turn. */
function isActive(current: unknown): boolean {
  return (
    typeof current === "object" &&
    current !== null &&
    !Array.isArray(current) &&
    (current as { active?: unknown }).active === true
  );
}

/**
 * Registers a token in the Initiative Tracker with its stored initiative. The
 * tracker's `active` flag belongs to the table: it is carried over from the
 * token's current value, and a token without one starts inactive.
 */
export const initiativeProjector: Projector = {
  key: INITIATIVE_METADATA_KEY,
  mode: "owned",
  project: (instance, current) =>
    instance.initiative === null
      ? undefined
      : { count: String(instance.initiative), active: isActive(current) },
};
