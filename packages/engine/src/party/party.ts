import { InvalidPartyError } from "./errors.js";

/** The party as the difficulty maths needs it: how many characters, and their one shared level. */
export interface Party {
  size: number;
  level: number;
}

/** Driven port: the stored party, one value or none. Stores what it is given; setParty checks it first. */
export interface PartyStore {
  /** The stored party, or null when none is set. */
  get(): Party | null;
  /** Stores the party, replacing any stored one. */
  set(party: Party): void;
}

/** What setParty changed: the party before (null when none was set) and after. */
export interface PartyChange {
  before: Party | null;
  after: Party;
}

/** Changes the given numbers of the stored party and stores the result. Throws InvalidPartyError naming each number neither given nor stored, else each number out of range; stores nothing then. */
export function setParty(
  store: PartyStore,
  change: Partial<Party>,
): PartyChange {
  const before = store.get();
  const after = checkParty(
    change.size ?? before?.size,
    change.level ?? before?.level,
  );
  store.set(after);
  return { before, after };
}

/** The party for one call: each number from the override when given, else the stored one. Throws as setParty does. */
export function resolveParty(
  stored: Party | null,
  override: Partial<Party>,
): Party {
  return checkParty(
    override.size ?? stored?.size,
    override.level ?? stored?.level,
  );
}

/** Names the numbers that are missing first, then the ones out of range; returns the party when both are set and valid. */
function checkParty(
  size: number | undefined,
  level: number | undefined,
): Party {
  if (size === undefined && level === undefined) {
    throw new InvalidPartyError("Party size and level are not set.");
  }
  if (size === undefined) {
    throw new InvalidPartyError("Party size is not set.");
  }
  if (level === undefined) {
    throw new InvalidPartyError("Party level is not set.");
  }
  const problems: string[] = [];
  if (!Number.isInteger(size) || size < 1) {
    problems.push(
      `Party size must be a whole number of 1 or more; got ${String(size)}.`,
    );
  }
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    problems.push(
      `Party level must be a whole number from 1 to 20; got ${String(level)}.`,
    );
  }
  if (problems.length > 0) {
    throw new InvalidPartyError(problems.join(" "));
  }
  return { size, level };
}
