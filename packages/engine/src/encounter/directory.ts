import { UnknownInstanceError } from "./errors.js";
import type { MapRepository } from "../map/repository.js";
import type { EncounterRepository } from "./repository.js";
import type { Encounter } from "./types.js";

/** The scene open at the table and the encounter bound to it, or undefined when none is. */
export interface OpenScene {
  sceneId: string;
  encounter: Encounter | undefined;
}

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
  /** The open scene with its bound encounter, or undefined when no scene is open; never writes. */
  getOpenScene(): OpenScene | undefined;
  /** Records the open scene, or that none is open (null); binds nothing. */
  setOpenScene(sceneId: string | null): void;
  /** Binds the scene to the encounter. Throws when the scene or the encounter is already bound, or the encounter is unknown; nothing changes then. */
  bindScene(sceneId: string, encounterId: string): void;
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

/** What a command asks of the encounter it acts on. */
export interface EncounterRequest {
  /** The encounter the DM named, matched ignoring case. */
  name?: string;
  /** The write form, which in an open scene with no encounter creates one, or the read form, which fails. */
  writes: boolean;
}

/** The encounter a command acts on, and whether resolving it created it. */
export interface ResolvedEncounter {
  encounter: Encounter;
  created: boolean;
}

/**
 * The encounter a command acts on: the named one; else the open scene's
 * bound one; else, in an open unbound scene, a new one bound to it (write
 * form) or NoSceneEncounterError (read form); else the current one, created
 * when none is.
 */
export function resolveEncounter(
  directory: EncounterDirectory,
  request: EncounterRequest,
): ResolvedEncounter {
  void directory;
  void request;
  throw new Error("not implemented");
}

/** Records the scene open at the table (or none) and, when it is bound, makes its encounter current, in one transaction. */
export function openScene(
  directory: EncounterDirectory,
  sceneId: string | null,
): void {
  void directory;
  void sceneId;
  throw new Error("not implemented");
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
