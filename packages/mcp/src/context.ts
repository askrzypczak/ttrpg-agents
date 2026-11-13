import type {
  BrowserPort,
  EncounterDirectory,
  EncounterRepository,
  MapRepository,
  MonsterIndex,
  Rng,
  SetupPorts,
  TablePort,
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
  rng: Rng;
  now: () => Date;
  newGroupId: () => string;
  /** Source of command ids: one per tool call, shared by all its writes. */
  newCommandId: () => string;
  /** Settings facts and the database and bridge probes, for the setup report. */
  setup: SetupPorts;
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
