import type { EncounterDirectory, OpenScene } from "../encounter/directory.js";
import type { EncounterRepository } from "../encounter/repository.js";
import type { TablePort, TableSceneStatus } from "./port.js";

/**
 * The table's scene status plus the open scene's encounter count, the store's
 * open scene, whether the tab holds that scene's encounter, and the in-sync
 * verdict.
 */
export interface TableStatus extends TableSceneStatus {
  encounterCount: number;
  inSync: boolean;
  openScene: OpenScene | undefined;
  holdsOpenScene: boolean | undefined;
}

/**
 * Asks the table for its scene status, then reads the store's open scene and
 * compares the two. `holdsOpenScene` is undefined for an older tab (no
 * `sceneId` or `heldEncounterId`), else true exactly when a scene is open, the
 * tab has that scene open and holds its bound encounter (null for none).
 * `inSync` = scene ready, `holdsOpenScene` not false, token, applied and the
 * open scene's encounter counts all equal, and no art picker open or still to
 * open (a `pick` wait holds tokens back; a `reupload` wait does not, its
 * tokens are circles). `unmanagedTokenCount` never affects it. Creates and
 * resolves no encounter. The port's errors (`TableUnavailableError`)
 * propagate.
 */
export async function getTableStatus(
  directory: Pick<EncounterDirectory, "getOpenScene"> & {
    repositoryFor(
      encounterId: string,
    ): Pick<EncounterRepository, "listInstances">;
  },
  table: TablePort,
): Promise<TableStatus> {
  const scene = await table.sceneStatus();
  const openScene = directory.getOpenScene();
  const encounterCount = openScene?.encounter
    ? directory.repositoryFor(openScene.encounter.id).listInstances().length
    : 0;
  const holdsOpenScene =
    scene.sceneId === undefined || scene.heldEncounterId === undefined
      ? undefined
      : openScene !== undefined &&
        scene.sceneId === openScene.sceneId &&
        scene.heldEncounterId === (openScene.encounter?.id ?? null);
  return {
    ...scene,
    encounterCount,
    openScene,
    holdsOpenScene,
    inSync:
      scene.sceneReady &&
      holdsOpenScene !== false &&
      scene.tokenCount === scene.appliedInstanceCount &&
      scene.tokenCount === encounterCount &&
      !scene.artWaits.some((wait) => wait.step === "pick"),
  };
}
