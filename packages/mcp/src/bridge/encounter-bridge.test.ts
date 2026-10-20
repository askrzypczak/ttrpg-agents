import { describe, expect, it } from "vitest";
import {
  SqliteEncounterRepository,
  createEncounterEmitter,
  observeRepository,
  openDatabase,
} from "@ttrpg-agents/core";
import type { BridgeMessage } from "@ttrpg-agents/core/bridge";
import { forwardEncounterEvents, snapshotMessage } from "./encounter-bridge.js";

function setup() {
  const inner = new SqliteEncounterRepository(openDatabase(":memory:"));
  const emitter = createEncounterEmitter();
  const sent: BridgeMessage[] = [];
  forwardEncounterEvents(emitter, { broadcast: (m) => sent.push(m) });
  return { inner, repo: observeRepository(inner, emitter), sent };
}

describe("forwardEncounterEvents", () => {
  it("broadcasts each repository mutation as an encounter-event", () => {
    const { repo, sent } = setup();
    const [a] = repo.addInstances(() => [
      { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
    ]);
    repo.removeInstances([a!.id]);
    expect(sent).toEqual([
      {
        v: 1,
        type: "encounter-event",
        payload: { type: "added", instances: [a] },
      },
      {
        v: 1,
        type: "encounter-event",
        payload: { type: "removed", id: a!.id },
      },
    ]);
  });
});

describe("snapshotMessage", () => {
  it("contains the current instances", () => {
    const { repo, inner } = setup();
    const created = repo.addInstances(() => [
      { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
    ]);
    expect(snapshotMessage(inner)).toEqual({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: created },
    });
  });
});
