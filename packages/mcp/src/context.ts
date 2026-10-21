import type { BridgeClient } from "@ttrpg-agents/bridge/client";
import type {
  EncounterRepository,
  MonsterIndex,
  Rng,
} from "@ttrpg-agents/engine";

/** Everything a tool handler needs; injected so tests stay deterministic. */
export interface ToolContext {
  /** Asks the Owlbear table, via the running bridge. */
  bridge: BridgeClient;
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
  newGroupId: () => string;
}
