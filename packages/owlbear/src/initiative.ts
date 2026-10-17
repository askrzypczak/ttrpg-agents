import type { ObrAdapter } from "./obr-adapter.js";

/** Metadata key used by the Owlbear Initiative Tracker extension. */
export const INITIATIVE_METADATA_KEY =
  "rodeo.owlbear.initiative-tracker/metadata";

/** Worked example: write tracker state without clobbering other metadata. */
export async function writeInitiativeMetadata(
  obr: ObrAdapter,
  value: unknown,
): Promise<void> {
  await obr.setSceneMetadata({ [INITIATIVE_METADATA_KEY]: value });
}
