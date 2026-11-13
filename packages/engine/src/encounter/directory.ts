import { UnknownInstanceError } from "./errors.js";
import type { MapRepository } from "../map/repository.js";
import type { EncounterRepository } from "./repository.js";
import type { Encounter } from "./types.js";

/** Every encounter in the store, the current one, and repositories scoped to one. */
export interface EncounterDirectory {
  /** Every encounter, oldest first. */
  listEncounters(): Encounter[];
  /** Stores a new encounter with this name, not current. Throws when another encounter has the name ignoring case; nothing is stored then. */
  createEncounter(name: string): Encounter;
  /** The current encounter, or undefined when none is; never creates one. */
  getCurrentEncounter(): Encounter | undefined;
  /** Makes that encounter current and the previous one not. Throws for an unknown id; nothing changes then. */
  setCurrentEncounter(id: string): void;
  /** The encounter whose instances (live or removed) include this id, or undefined. */
  findEncounterOfInstance(instanceId: string): Encounter | undefined;
  /** A repository whose every method reads and changes that encounter only. */
  repositoryFor(encounterId: string): EncounterRepository;
  /** A map repository whose map is that encounter's; rooms are keyed by map item and shared by every encounter on it. */
  mapRepositoryFor(encounterId: string): MapRepository;
  /** Runs fn in one write transaction; directory and repository calls inside join it; a throw rolls them back and is rethrown. */
  transaction<T>(fn: () => T): T;
}

/** "Encounter N" with the lowest N >= 1 that none of `names` takes, ignoring case. */
export function nextEncounterName(names: readonly string[]): string {
  const taken = new Set(names.map((name) => name.toLowerCase()));
  let n = 1;
  while (taken.has(`encounter ${String(n)}`)) n++;
  return `Encounter ${String(n)}`;
}

/** The encounter a command acts on: the current one; when none is, a new one named by nextEncounterName and made current, in one transaction. */
export function resolveEncounter(directory: EncounterDirectory): Encounter {
  const current = directory.getCurrentEncounter();
  if (current) return current;
  return directory.transaction(() => {
    // Re-read inside the write transaction: another process may have made
    // one current since the read above.
    const raced = directory.getCurrentEncounter();
    if (raced) return raced;
    const names = directory.listEncounters().map((e) => e.name);
    const created = directory.createEncounter(nextEncounterName(names));
    directory.setCurrentEncounter(created.id);
    return created;
  });
}

/** The repository of the encounter that holds the instance; throws UnknownInstanceError when no encounter does. */
export function repositoryForInstance(
  directory: EncounterDirectory,
  instanceId: string,
): EncounterRepository {
  const holder = directory.findEncounterOfInstance(instanceId);
  if (!holder)
    throw new UnknownInstanceError(`Unknown monster instance: ${instanceId}`);
  return directory.repositoryFor(holder.id);
}
