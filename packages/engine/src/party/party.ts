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
  void store;
  void change;
  throw new Error("not implemented");
}

/** The party for one call: each number from the override when given, else the stored one. Throws as setParty does. */
export function resolveParty(
  stored: Party | null,
  override: Partial<Party>,
): Party {
  void stored;
  void override;
  throw new Error("not implemented");
}
