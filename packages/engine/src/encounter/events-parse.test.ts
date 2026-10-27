import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { encounterEventSchema, type EncounterEvent } from "./events.js";
import type { ChangeOrigin } from "./origin.js";

const origin: ChangeOrigin = { source: "table", commandId: "c2" };

const events: EncounterEvent[] = [
  { type: "added", instances: [makeTestInstance()], origin },
  { type: "removed", id: "i1", origin },
  { type: "cleared", origin },
  { type: "hp-changed", id: "i1", currentHp: 3, maxHp: 10, origin },
  {
    type: "instance-changed",
    id: "i1",
    changes: {
      name: "Boss",
      initiative: 14,
      armorClass: 18,
      statsVisible: true,
    },
    origin,
  },
];

describe("encounterEventSchema parse", () => {
  it.each(events)(
    "returns a $type event with every field it was given",
    (event) => {
      expect(encounterEventSchema.parse(event)).toEqual(event);
    },
  );

  it("an instance-changed event with a null initiative parses", () => {
    const event = {
      type: "instance-changed",
      id: "i1",
      changes: { initiative: null },
      origin,
    };

    const result = encounterEventSchema.safeParse(event);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(event);
  });

  it("an instance-changed event carrying only a groupId parses and keeps it", () => {
    const event = {
      type: "instance-changed",
      id: "i1",
      changes: { groupId: "g7" },
      origin,
    };

    const result = encounterEventSchema.safeParse(event);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(event);
  });

  it("rejects an instance-changed event whose changes hold only unknown keys", () => {
    const result = encounterEventSchema.safeParse({
      type: "instance-changed",
      id: "i1",
      changes: { colour: "red" },
      origin,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "changes must name at least one field",
    );
  });
});
