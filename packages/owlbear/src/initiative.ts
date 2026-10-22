import type { Projector } from "./sync-plan.js";

/** Metadata key used by the Owlbear Initiative Tracker extension. */
export const INITIATIVE_METADATA_KEY =
  "rodeo.owlbear.initiative-tracker/metadata";

/** Registers a token in the Initiative Tracker with its stored initiative. */
export const initiativeProjector: Projector = {
  get key(): string {
    throw new Error("not implemented");
  },
  get mode(): Projector["mode"] {
    throw new Error("not implemented");
  },
  project: () => {
    throw new Error("not implemented");
  },
};
