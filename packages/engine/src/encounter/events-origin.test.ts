import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { encounterEventSchema, type EncounterEvent } from "./events.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "c1" };

const withOrigin = {
  added: { type: "added", instances: [makeTestInstance()], origin },
  removed: { type: "removed", id: "i1", origin },
  cleared: { type: "cleared", origin },
  "hp-changed": {
    type: "hp-changed",
    id: "i1",
    currentHp: 3,
    maxHp: 10,
    origin,
  },
} satisfies Record<string, EncounterEvent>;

describe("encounterEventSchema origin", () => {
  it("encounterEventSchema requires origin on added, removed, cleared and hp-changed", () => {
    for (const event of Object.values(withOrigin)) {
      expect(encounterEventSchema.safeParse(event).success).toBe(true);

      expect(
        encounterEventSchema.safeParse({ ...event, origin: undefined }).success,
      ).toBe(false);
    }
  });

  it("encounterEventSchema accepts instance-changed with changed fields and origin", () => {
    const parsed = encounterEventSchema.safeParse({
      type: "instance-changed",
      id: "i1",
      changes: { name: "Boss", armorClass: 18 },
      origin: { source: "table", commandId: "c9" },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      type: "instance-changed",
      id: "i1",
      changes: { name: "Boss", armorClass: 18 },
      origin: { source: "table", commandId: "c9" },
    });
  });

  it("encounterEventSchema requires origin on position-changed", () => {
    const event = {
      type: "position-changed",
      id: "i1",
      spawnPosition: { x: 250, y: 150 },
      origin,
    };

    const parsed = encounterEventSchema.safeParse(event);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(event);
    expect(
      encounterEventSchema.safeParse({ ...event, origin: undefined }).success,
    ).toBe(false);
  });

  it("encounterEventSchema rejects instance-changed with no changes", () => {
    const event = {
      type: "instance-changed",
      id: "i1",
      origin,
    };
    // Control: the same event with a change is accepted.
    expect(
      encounterEventSchema.safeParse({
        ...event,
        changes: { initiative: 12 },
      }).success,
    ).toBe(true);

    expect(
      encounterEventSchema.safeParse({ ...event, changes: {} }).success,
    ).toBe(false);
  });
});

type MutationName = Exclude<
  keyof EncounterRepository,
  "getOrCreateActiveEncounter" | "listInstances" | "listRemovedInstances"
>;

/** The event type each repository mutation is reported as. */
const eventForMutation: Record<MutationName, EncounterEvent["type"]> = {
  addInstances: "added",
  applyDamage: "hp-changed",
  applyHealing: "hp-changed",
  removeInstances: "removed",
  restoreInstances: "added",
  renameInstance: "instance-changed",
  setInitiative: "instance-changed",
  setHp: "hp-changed",
  setMaxHp: "hp-changed",
  setArmorClass: "instance-changed",
  setStatsVisible: "instance-changed",
  setSpawnPositions: "position-changed",
  clearEncounter: "cleared",
};

const sampleEvents: Record<EncounterEvent["type"], unknown> = {
  ...withOrigin,
  "instance-changed": {
    type: "instance-changed",
    id: "i1",
    changes: { statsVisible: true },
    origin,
  },
  "position-changed": {
    type: "position-changed",
    id: "i1",
    spawnPosition: { x: 250, y: 150 },
    origin,
  },
};

describe("repository mutations and events", () => {
  it("every repository mutation has an event type in the schema", () => {
    const schemaTypes = encounterEventSchema.options.map(
      (option) => option.shape.type.value,
    );

    for (const type of Object.values(eventForMutation)) {
      expect(schemaTypes).toContain(type);
      expect(encounterEventSchema.safeParse(sampleEvents[type]).success).toBe(
        true,
      );
    }
  });
});
