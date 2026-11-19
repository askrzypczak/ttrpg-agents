import type {
  BrowserPort,
  CreatureRepository,
  EncounterDirectory,
  EncounterRepository,
  ImageSource,
  MapRepository,
  MonsterIndex,
  Rng,
  SetupPorts,
  TablePort,
  Tokeniser,
} from "@ttrpg-agents/engine";

/** Everything a tool handler needs; injected so tests stay deterministic. */
export interface ToolContext {
  /** Asks the table (in production the Owlbear GM tab, via the bridge). */
  table: TablePort;
  /** Shows a page to the DM (in production the system browser). */
  browser: BrowserPort;
  /** Every encounter, the current one, and repositories scoped to one. */
  encounters: EncounterDirectory;
  monsters: MonsterIndex;
  /** The creatures the DM stored: create_creature writes here, and `monsters` reads the same store. */
  creatures: CreatureRepository;
  rng: Rng;
  now: () => Date;
  newGroupId: () => string;
  /** Source of command ids: one per tool call, shared by all its writes. */
  newCommandId: () => string;
  /** Settings facts and the database and bridge probes, for the setup report. */
  setup: SetupPorts;
  /** Renders token images (in production sharp, via the imaging adapter). */
  tokeniser: Tokeniser;
  /** Loads source images from absolute paths and https URLs. */
  imageSource: ImageSource;
}

/** What a tool's run receives: the context plus the encounter of this call. */
export interface ToolCallContext extends ToolContext {
  /**
   * The encounter this call acts on, from the engine's resolution rule (the
   * write form for tools that start an encounter, the read form otherwise),
   * resolved on first use and kept for the call.
   */
  readonly repo: EncounterRepository;
  /** The map repository of this call's encounter, resolved by the same rule with `repo` and kept for the call. */
  readonly maps: MapRepository;
}
