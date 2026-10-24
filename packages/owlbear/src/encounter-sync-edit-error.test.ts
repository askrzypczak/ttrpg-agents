import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY } from "./sync-plan.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const error = (id: string | undefined, fatal: boolean): BridgeMessage => ({
  v: 1,
  type: "error",
  ...(id !== undefined ? { id } : {}),
  payload: { code: "unknown_instance", message: "gone", fatal },
});

/** Table HP after the message arrives with an unsent-then-sent edit of 5. */
async function healthAfter(message: BridgeMessage): Promise<unknown> {
  const { obr, scene } = createFakeObr();
  const sync = createEncounterSync(obr);
  await sync.handleMessage({
    v: 1,
    type: "encounter-snapshot",
    payload: {
      instances: [
        makeTestInstance({
          id: "i1",
          maxHp: 16,
          currentHp: 10,
          armorClass: 12,
        }),
      ],
    },
  });
  await settle();
  const token = scene
    .getItems()
    .find((i) => i.metadata[INSTANCE_METADATA_KEY] !== undefined)!;
  scene.setItemMetadata([
    {
      id: token.id,
      key: STAT_BUBBLES_METADATA_KEY,
      value: {
        ...(token.metadata[STAT_BUBBLES_METADATA_KEY] as object),
        health: 5,
      },
    },
  ]);
  await settle();
  await sync.handleMessage(message);
  await settle();
  return (
    scene.getItems().find((i) => i.id === token.id)!.metadata[
      STAT_BUBBLES_METADATA_KEY
    ] as Record<string, unknown>
  ).health;
}

describe("createEncounterSync reacting to errors", () => {
  it.each([
    [
      "a non-fatal error answering an instance-edit",
      error("instance-edit:i1", false),
    ],
    ["a fatal error with that id", error("instance-edit:i1", true)],
    ["a non-fatal error with another id", error("token-deleted:i1", false)],
    ["a non-fatal error without an id", error(undefined, false)],
    [
      "a message that is not an error",
      {
        v: 1,
        type: "pong",
        id: "instance-edit:i1",
        payload: {},
      } as BridgeMessage,
    ],
  ])("leaves the table alone for %s", async (_name, message) => {
    expect(await healthAfter(message)).toBe(5);
  });
});
