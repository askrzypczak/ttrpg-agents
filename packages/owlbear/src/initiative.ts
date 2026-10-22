import type { Projector } from "./sync-plan.js";

/** Metadata key used by the Owlbear Initiative Tracker extension. */
export const INITIATIVE_METADATA_KEY =
  "rodeo.owlbear.initiative-tracker/metadata";

/** Registers a token in the Initiative Tracker with its stored initiative. */
export const initiativeProjector: Projector = {
  key: INITIATIVE_METADATA_KEY,
  mode: "owned",
  project: (instance) =>
    instance.initiative === null
      ? undefined
      : { count: String(instance.initiative), active: false },
};
