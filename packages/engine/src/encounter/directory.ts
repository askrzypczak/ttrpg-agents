import {
  NoSceneEncounterError,
  UnknownEncounterError,
  UnknownInstanceError,
} from "./errors.js";
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
  /** Renames the encounter; the store's unique index refuses a name another encounter has ignoring ASCII case. */
  setEncounterName(encounterId: string, name: string): void;
  /** The id of the scene bound to that encounter, or undefined when none is. */
  findSceneOfEncounter(encounterId: string): string | undefined;
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
  /** Whether a reply's text names the encounter: no scene is open, the request named an encounter other than the open scene's, or this call created it. */
  mention: boolean;
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
  if (request.name !== undefined)
    return withMention(namedEncounter(directory, request.name), false);
  const open = directory.getOpenScene();
  if (open?.encounter) return withMention(open.encounter, false);
  if (open) {
    if (!request.writes)
      throw new NoSceneEncounterError("This scene has no encounter yet.");
  } else {
    const current = directory.getCurrentEncounter();
    if (current) return withMention(current, false);
  }
  return directory.transaction(() =>
    createUnderLock(directory, request.writes),
  );
}

/**
 * The named encounter, matched ignoring case. With no scene open it also
 * becomes current; while a scene is open the current encounter stays.
 */
function namedEncounter(
  directory: EncounterDirectory,
  name: string,
): Encounter {
  const encounters = directory.listEncounters();
  const wanted = name.toLowerCase();
  const found = encounters.find((e) => e.name.toLowerCase() === wanted);
  if (!found) {
    const known =
      encounters.length === 0
        ? "there are no encounters"
        : `known encounters: ${encounters.map((e) => e.name).join(", ")}`;
    throw new UnknownEncounterError(`Unknown encounter "${name}"; ${known}.`);
  }
  if (
    directory.getOpenScene() === undefined &&
    directory.getCurrentEncounter()?.id !== found.id
  ) {
    directory.transaction(() => {
      // Another process shares the database: read again under the write lock,
      // as it may have opened a scene or made this encounter current since.
      if (directory.getOpenScene() !== undefined) return;
      if (directory.getCurrentEncounter()?.id === found.id) return;
      directory.setCurrentEncounter(found.id);
    });
  }
  return found;
}

/**
 * Inside the write transaction, the encounter a command acts on when the
 * reads before it found none: in an open scene, a new one bound to the scene
 * and made current (the read form fails there instead); with no scene open,
 * a new current one. Another process shares the database, so the open scene
 * and the current encounter are read again under the lock: it may have bound
 * the scene, opened or closed one, or made an encounter current since.
 */
function createUnderLock(
  directory: EncounterDirectory,
  writes: boolean,
): ResolvedEncounter {
  const open = directory.getOpenScene();
  if (open?.encounter) return withMention(open.encounter, false);
  if (!open) {
    const current = directory.getCurrentEncounter();
    if (current) return withMention(current, false);
  }
  if (open && !writes)
    throw new NoSceneEncounterError("This scene has no encounter yet.");
  const names = directory.listEncounters().map((e) => e.name);
  const created = directory.createEncounter(nextEncounterName(names));
  if (open) directory.bindScene(open.sceneId, created.id);
  directory.setCurrentEncounter(created.id);
  return withMention(created, true);
}

/** The resolved encounter with whether a reply names it. */
function withMention(
  encounter: Encounter,
  created: boolean,
): ResolvedEncounter {
  return { encounter, created, mention: mentions() };
}

function mentions(): boolean {
  throw new Error("not implemented");
}

/** Records the scene open at the table (or none) and, when it is bound, makes its encounter current, in one transaction. */
export function openScene(
  directory: EncounterDirectory,
  sceneId: string | null,
): void {
  directory.transaction(() => {
    directory.setOpenScene(sceneId);
    if (sceneId === null) return;
    const bound = directory.getOpenScene()?.encounter;
    if (bound) directory.setCurrentEncounter(bound.id);
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

/** One encounter as list_encounters shows it. */
export interface EncounterSummary {
  encounter: Encounter;
  /** Its live monsters; removed ones are not counted. */
  monsterCount: number;
  /** Bound to a scene, open or not. */
  bound: boolean;
  /** Bound to the open scene. */
  openScene: boolean;
  current: boolean;
}

export interface EncounterListing {
  /** Oldest first. */
  encounters: EncounterSummary[];
  sceneOpen: boolean;
}

/** Every encounter with its monster count and scene state; reads only, creates nothing. */
export function listEncounterSummaries(
  directory: EncounterDirectory,
): EncounterListing {
  void directory;
  throw new Error("not implemented");
}

export interface RenameEncounterRequest {
  /** The new name; trimmed. */
  name: string;
  /** The encounter to rename, by name ignoring case; default: the read form of the resolution rule. */
  encounter?: string;
}

export interface RenamedEncounter {
  /** The encounter under its new name. */
  encounter: Encounter;
  renamedFrom: string;
  /** Whether resolving it created it. */
  created: boolean;
}

/** Renames the encounter the request resolves. InvalidNameError for an empty name (before resolving) or one another encounter has ignoring case; nothing changes then. */
export function renameEncounter(
  directory: EncounterDirectory,
  request: RenameEncounterRequest,
): RenamedEncounter {
  void directory;
  void request;
  throw new Error("not implemented");
}

/** Binds the named encounter to the open scene and makes it current, in one transaction; SceneBindingError or UnknownEncounterError otherwise, changing nothing. */
export function useEncounter(
  directory: EncounterDirectory,
  name: string,
): Encounter {
  void directory;
  void name;
  throw new Error("not implemented");
}
