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
  /** Runs fn in one write transaction; directory and repository calls inside join it; a throw rolls them back and is rethrown. */
  transaction<T>(fn: () => T): T;
}

/** "Encounter N" with the lowest N >= 1 that none of `names` takes, ignoring case. */
export function nextEncounterName(names: readonly string[]): string {
  void names;
  throw new Error("not implemented");
}

/** The encounter a command acts on: the current one; when none is, a new one named by nextEncounterName and made current, in one transaction. */
export function resolveEncounter(directory: EncounterDirectory): Encounter {
  void directory;
  throw new Error("not implemented");
}

/** The repository of the encounter that holds the instance; throws UnknownInstanceError when no encounter does. */
export function repositoryForInstance(
  directory: EncounterDirectory,
  instanceId: string,
): EncounterRepository {
  void directory;
  void instanceId;
  throw new Error("not implemented");
}
