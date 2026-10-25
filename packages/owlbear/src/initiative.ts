import type { Projector } from "./sync-plan.js";

/** Metadata key used by the Owlbear Initiative Tracker extension. */
export const INITIATIVE_METADATA_KEY =
  "rodeo.owlbear.initiative-tracker/metadata";

/** A count the store can hold: optional sign, then digits. */
const WHOLE_NUMBER = /^[+-]?\d+$/;

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
 * token's current value, and a token without one starts inactive. A count
 * typed in the tracker is read back as the initiative; a token removed from
 * the tracker clears it.
 */
export const initiativeProjector: Projector = {
  key: INITIATIVE_METADATA_KEY,
  mode: "owned",
  project: (instance, current) =>
    instance.initiative === null
      ? undefined
      : { count: String(instance.initiative), active: isActive(current) },
  editFields: { initiative: "count" },
  // The tracker keeps the count as free text.
  encodeField: (_field, value) => String(value),
  readBack: (value, instance) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      // The key is gone: the token left the tracker.
      return {
        edit: instance.initiative === null ? {} : { initiative: null },
        invalid: [],
      };
    const count = (value as { count?: unknown }).count;
    const typed = typeof count === "string" ? count.trim() : "";
    const initiative = WHOLE_NUMBER.test(typed) ? Number(typed) : undefined;
    if (initiative === undefined || !Number.isSafeInteger(initiative))
      return { edit: {}, invalid: ["count"] };
    return {
      edit: initiative === instance.initiative ? {} : { initiative },
      invalid: [],
    };
  },
};
