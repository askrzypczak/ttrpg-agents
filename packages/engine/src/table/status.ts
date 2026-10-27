import type { EncounterRepository } from "../encounter/repository.js";
import type { TablePort, TableSceneStatus } from "./port.js";

/** The table's scene status plus the encounter count and the in-sync verdict. */
export interface TableStatus extends TableSceneStatus {
  encounterCount: number;
  inSync: boolean;
}

/**
 * Asks the table for its scene status and compares it with the encounter.
 * `inSync` = scene ready, token, applied and encounter counts all equal, and
 * no art picker open or still to open (a `pick` wait holds tokens back; a
 * `reupload` wait does not, its tokens are circles). The port's errors
 * (`TableUnavailableError`) propagate.
 */
export async function getTableStatus(
  repo: Pick<EncounterRepository, "listInstances">,
  table: TablePort,
): Promise<TableStatus> {
  const scene = await table.sceneStatus();
  const encounterCount = repo.listInstances().length;
  return {
    ...scene,
    encounterCount,
    inSync:
      scene.sceneReady &&
      scene.tokenCount === scene.appliedInstanceCount &&
      scene.tokenCount === encounterCount &&
      !scene.artWaits.some((wait) => wait.step === "pick"),
  };
}
