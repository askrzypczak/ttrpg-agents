import type { EncounterRepository } from "../encounter/repository.js";
import type { TablePort, TableSceneStatus } from "./port.js";

/** The table's scene status plus the encounter count and the in-sync verdict. */
export interface TableStatus extends TableSceneStatus {
  encounterCount: number;
  inSync: boolean;
}

/**
 * Asks the table for its scene status and compares it with the encounter.
 * `inSync` = scene ready and token, applied and encounter counts all equal.
 * The port's errors (`TableUnavailableError`) propagate.
 */
export function getTableStatus(
  repo: Pick<EncounterRepository, "listInstances">,
  table: TablePort,
): Promise<TableStatus> {
  void repo;
  void table;
  throw new Error("not implemented");
}
