import type {
  EncounterRepository,
  MapRepository,
  MonsterIndex,
  Rng,
  TablePort,
} from "@ttrpg-agents/engine";

/** Everything a tool handler needs; injected so tests stay deterministic. */
export interface ToolContext {
  /** Asks the table (in production the Owlbear GM tab, via the bridge). */
  table: TablePort;
  repo: EncounterRepository;
  /** Registered maps and the active one. */
  maps: MapRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
  newGroupId: () => string;
  /** Source of command ids: one per tool call, shared by all its writes. */
  newCommandId: () => string;
}
