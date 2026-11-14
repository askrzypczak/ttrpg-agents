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
 * Asks the table for its scene status and compares it with the open scene's
 * bound encounter. The port's errors (`TableUnavailableError`) propagate.
 */
export function getTableStatus(
  directory: Pick<EncounterDirectory, "getOpenScene"> & {
    repositoryFor(
      encounterId: string,
    ): Pick<EncounterRepository, "listInstances">;
  },
  table: TablePort,
): Promise<TableStatus> {
  void directory;
  void table;
  throw new Error("not implemented");
}
