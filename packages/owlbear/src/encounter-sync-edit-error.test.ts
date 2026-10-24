import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { EDIT_SETTLE_MS } from "./edit-settle.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY } from "./sync-plan.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Timers on a fake clock that only moves when `advance` is called. */
class FakeTimers implements Timers {
  private now = 0;
  private next = 1;
  private readonly pending = new Map<number, { fn: () => void; at: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, at: this.now + ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  /** Moves the clock forward, firing due timers in order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (due === undefined) break;
      const [id, t] = due;
      this.pending.delete(id);
      this.now = t.at;
      t.fn();
    }
    this.now = end;
  }
}

const error = (id: string | undefined, fatal: boolean): BridgeMessage => ({
  v: 1,
  type: "error",
  ...(id !== undefined ? { id } : {}),
  payload: { code: "unknown_instance", message: "gone", fatal },
});

/** Table HP after the message arrives with an unsent-then-sent edit of 5. */
async function healthAfter(message: BridgeMessage): Promise<unknown> {
  const { obr, scene } = createFakeObr();
  const timers = new FakeTimers();
  const sync = createEncounterSync(obr, undefined, undefined, { timers });
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
  timers.advance(EDIT_SETTLE_MS);
  await sync.handleMessage(message);
  await settle();
  return (
    scene.getItems().find((i) => i.id === token.id)!.metadata[
      STAT_BUBBLES_METADATA_KEY
    ] as Record<string, unknown>
  ).health;
}

describe("createEncounterSync reacting to errors", () => {
  it("reverts the table for a non-fatal error answering an instance-edit", async () => {
    expect(await healthAfter(error("instance-edit:i1", false))).toBe(10);
  });

  it.each([
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
