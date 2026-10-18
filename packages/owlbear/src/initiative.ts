import type { ObrAdapter } from "./obr-adapter.js";
import type { Metadata } from "./scene-model.js";

/** Metadata key used by the Owlbear Initiative Tracker extension. */
export const INITIATIVE_METADATA_KEY =
  "rodeo.owlbear.initiative-tracker/metadata";

/**
 * Item metadata that registers a token with the Initiative Tracker at
 * `initiative`. `{}` when there is no initiative yet, so the token is not
 * listed.
 */
export function initiativeMetadata(initiative: number | null): Metadata {
  if (initiative === null) return {};
  return {
    [INITIATIVE_METADATA_KEY]: { count: String(initiative), active: false },
  };
}

/** Worked example: write tracker state without clobbering other metadata. */
export async function writeInitiativeMetadata(
  obr: ObrAdapter,
  value: unknown,
): Promise<void> {
  await obr.setSceneMetadata({ [INITIATIVE_METADATA_KEY]: value });
}
