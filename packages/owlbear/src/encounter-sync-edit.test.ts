import { describe, expect, it } from "vitest";
import type { ChangeOrigin, InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { SceneItem, SceneModel } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  INSTANCE_METADATA_KEY,
  SYNCED_METADATA_KEY,
  type EncounterInstance,
} from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Shadow 1",
    maxHp: 16,
    currentHp: 10,
    armorClass: 12,
    ...over,
  });

const snapshot = (instance: EncounterInstance, seq = 0): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance], seq },
});

const helloAck: BridgeMessage = {
  v: 1,
  type: "hello-ack",
  payload: { serverVersion: "0" },
};

const mcp: ChangeOrigin = { source: "mcp", commandId: "agent" };
const tableOf = (commandId: string): ChangeOrigin => ({
  source: "table",
  commandId,
});

/** The store's `hp-changed` event for i1 (a max HP or HP setter records one). */
const hpChanged = (
  seq: number,
  currentHp: number,
  maxHp: number,
  origin: ChangeOrigin,
): BridgeMessage => ({
  v: 1,
  type: "encounter-event",
  payload: { type: "hp-changed", id: "i1", currentHp, maxHp, origin, seq },
});

/** The store's `instance-changed` event for i1 (an armor class setter records one). */
const armorClassChanged = (
  seq: number,
  armorClass: number,
  origin: ChangeOrigin,
): BridgeMessage => ({
  v: 1,
  type: "encounter-event",
  payload: {
    type: "instance-changed",
    id: "i1",
    changes: { armorClass },
    origin,
    seq,
  },
});

const refusal = (id: string | undefined): BridgeMessage => ({
  v: 1,
  type: "error",
  ...(id !== undefined ? { id } : {}),
  payload: { code: "unknown_instance", message: "gone", fatal: false },
});

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
};

/** Lets fire-and-forget reconciles (item changes) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Our token for instance i1. */
const token = (scene: SceneModel): SceneItem =>
  scene
    .getItems()
    .find(
      (i) =>
        (
          i.metadata[INSTANCE_METADATA_KEY] as
            { instanceId?: string } | undefined
        )?.instanceId === "i1",
    )!;

const bubbles = (scene: SceneModel): Record<string, unknown> =>
  token(scene).metadata[STAT_BUBBLES_METADATA_KEY] as Record<string, unknown>;

/** The Stat Bubbles value the extension last wrote (the baseline). */
const baselineBubbles = (scene: SceneModel): Record<string, unknown> =>
  (token(scene).metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
    STAT_BUBBLES_METADATA_KEY
  ] as Record<string, unknown>;

/** Edits the token's stat bubbles at the table, as the GM or a player would. */
function editAtTable(scene: SceneModel, fields: Record<string, unknown>) {
  scene.setItemMetadata([
    {
      id: token(scene).id,
      key: STAT_BUBBLES_METADATA_KEY,
      value: { ...bubbles(scene), ...fields },
    },
  ]);
}

/** A sync over a fake scene with a socket that can be down, recording what the panel would hear. */
async function setup(options: { withSend?: boolean } = {}) {
  const fake = createFakeObr();
  const scene = fake.scene;
  const metadataWrites: { id: string; key: string; value: unknown }[] = [];
  const obr: ObrAdapter = {
    ...fake.obr,
    setItemMetadata: (updates) => {
      metadataWrites.push(...updates);
      return fake.obr.setItemMetadata(updates);
    },
  };
  const socket = { open: true };
  const sent: BridgeMessage[] = [];
  const heard = {
    rejected: [] as string[],
    notes: [] as string[],
    overrides: [] as string[],
    waiting: [] as number[],
  };
  const sync = createEncounterSync(obr, undefined, undefined, {
    ...(options.withSend === false
      ? {}
      : {
          send: (message: BridgeMessage) => {
            if (!socket.open) return false;
            sent.push(message);
            return true;
          },
        }),
    onEditRejected: (text) => heard.rejected.push(text),
    onEditDiffers: (text) => heard.notes.push(text),
    onSnapshotOverride: (text) => heard.overrides.push(text),
    onWaitingChange: (waiting) => heard.waiting.push(waiting),
  });
  await sync.handleMessage(snapshot(inst()));
  await settle();
  metadataWrites.length = 0;
  return {
    sync,
    scene,
    socket,
    heard,
    metadataWrites,
    /** Every `instance-edit` sent so far. */
    edits: () =>
      sent.flatMap((m) =>
        m.type === "instance-edit" ? [{ id: m.id, edit: m.payload }] : [],
      ) as { id: string; edit: InstanceEdit }[],
    /** Every `token-deleted` sent so far. */
    deletions: () => sent.filter((m) => m.type === "token-deleted"),
    /** The Stat Bubbles writes since setup (the baseline record is a separate key). */
    bubbleWrites: () =>
      metadataWrites.filter((u) => u.key === STAT_BUBBLES_METADATA_KEY),
  };
}

describe("createEncounterSync table edit write-back", () => {
  it("createEncounterSync sends one instance-edit per table edit and not again on the next item change", async () => {
    const { sync, scene, edits } = await setup();
    expect(edits()).toEqual([]);

    editAtTable(scene, { health: 5 });
    await settle();
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", currentHp: 5 },
    ]);

    // An unrelated item change does not send it again.
    scene.addItems([foreign]);
    await settle();
    expect(edits()).toHaveLength(1);

    // The store's acknowledgement changes nothing on the table.
    await sync.handleMessage(hpChanged(1, 5, 16, tableOf(edits()[0]!.id)));
    await settle();
    expect(edits()).toHaveLength(1);
    expect(bubbles(scene).health).toBe(5);

    // A second table edit is sent once too.
    editAtTable(scene, { "max health": 20 });
    await settle();
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", maxHp: 20 },
    ]);
  });

  it("createEncounterSync reports an unparseable value once per snapshot", async () => {
    const { sync, scene, edits, heard } = await setup();

    editAtTable(scene, { health: "lots" });
    await settle();
    expect(heard.rejected).toHaveLength(1);

    // More reconciles without a new snapshot report nothing new.
    scene.addItems([foreign]);
    await settle();
    expect(heard.rejected).toHaveLength(1);

    // A new snapshot reports it again; the value stays on the table.
    await sync.handleMessage(snapshot(inst()));
    await settle();
    expect(heard.rejected).toHaveLength(2);
    expect(bubbles(scene).health).toBe("lots");
    expect(edits()).toEqual([]);
  });

  it("an mcp event that changes HP is pushed to a token whose HP edit was acknowledged since the last write", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();
    await sync.handleMessage(hpChanged(1, 5, 16, tableOf(edits()[0]!.id)));

    // The agent heals back to the value the token was last written with.
    await sync.handleMessage(hpChanged(2, 10, 16, mcp));
    await settle();

    expect(bubbles(scene).health).toBe(10);
    expect(edits()).toHaveLength(1);
  });

  it("a table event for a sent command pushes nothing and records the store value as the baseline", async () => {
    const { sync, scene, edits, bubbleWrites } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();

    await sync.handleMessage(hpChanged(1, 5, 16, tableOf(edits()[0]!.id)));
    await settle();

    expect(bubbleWrites()).toEqual([]);
    expect(bubbles(scene).health).toBe(5);
    expect(baselineBubbles(scene)).toMatchObject({ health: 5 });
    expect(edits()).toHaveLength(1);
  });

  it("a table event whose value differs from the sent one shows the clamp note and the token keeps the typed value", async () => {
    const { sync, scene, edits, heard } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();

    // The store clamps HP to the max HP of 16.
    await sync.handleMessage(hpChanged(1, 16, 16, tableOf(edits()[0]!.id)));
    await settle();

    expect(heard.notes).toHaveLength(1);
    for (const part of ["Shadow 1", "16", "99"])
      expect(heard.notes[0]).toContain(part);
    expect(bubbles(scene).health).toBe(99);
  });

  it("a clamped field is not sent again, and the next snapshot shows the store's value", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 99 });
    await settle();
    await sync.handleMessage(hpChanged(1, 16, 16, tableOf(edits()[0]!.id)));
    await settle();

    scene.addItems([foreign]);
    await settle();
    expect(edits()).toHaveLength(1);
    expect(bubbles(scene).health).toBe(99);

    await sync.handleMessage(snapshot(inst({ currentHp: 16 }), 1));
    await settle();

    expect(bubbles(scene).health).toBe(16);
    expect(edits()).toHaveLength(1);
  });

  it("a table event with a command id the extension did not send pushes nothing and records the store value", async () => {
    // No `send`: the extension remembers no command, as after a reload.
    const { sync, scene, bubbleWrites } = await setup({ withSend: false });
    editAtTable(scene, { health: 5 });
    await settle();

    await sync.handleMessage(
      hpChanged(1, 5, 16, tableOf("from-before-reload")),
    );
    await settle();

    expect(bubbleWrites()).toEqual([]);
    expect(bubbles(scene).health).toBe(5);
    expect(baselineBubbles(scene)).toMatchObject({ health: 5 });
  });

  it("two edits of one instance sent before either is acknowledged get two command ids and both typed values stay after both acknowledgements", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();
    editAtTable(scene, { health: 3 });
    await settle();
    const [first, second] = edits();
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", currentHp: 3 },
    ]);
    expect(first!.id).not.toBe(second!.id);

    // The older acknowledgement does not overwrite the newer typed value.
    await sync.handleMessage(hpChanged(1, 5, 16, tableOf(first!.id)));
    await settle();
    expect(bubbles(scene).health).toBe(3);

    await sync.handleMessage(hpChanged(2, 3, 16, tableOf(second!.id)));
    await settle();
    expect(bubbles(scene).health).toBe(3);
    expect(edits()).toHaveLength(2);
  });

  it("an MCP change to another field between an edit and its acknowledgement is pushed and the typed value stays", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();

    await sync.handleMessage(armorClassChanged(1, 15, mcp));
    await settle();
    expect(bubbles(scene)["armor class"]).toBe(15);
    expect(bubbles(scene).health).toBe(5);

    await sync.handleMessage(hpChanged(2, 5, 16, tableOf(edits()[0]!.id)));
    await settle();
    expect(bubbles(scene)["armor class"]).toBe(15);
    expect(bubbles(scene).health).toBe(5);
    expect(edits()).toHaveLength(1);
  });

  it("an edit made while the socket is down is sent after the next hello-ack, once, and the waiting count is 1 until then", async () => {
    const { sync, scene, socket, edits, heard } = await setup();
    socket.open = false;

    editAtTable(scene, { health: 5 });
    await settle();
    expect(edits()).toEqual([]);
    expect(heard.waiting.at(-1)).toBe(1);

    // The socket comes back: hello-ack, then the connect snapshot.
    socket.open = true;
    await sync.handleMessage(helloAck);
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", currentHp: 5 },
    ]);
    expect(heard.waiting.at(-1)).toBe(0);
    await sync.handleMessage(snapshot(inst()));
    await settle();

    expect(edits()).toHaveLength(1);
    expect(bubbles(scene).health).toBe(5);
  });

  it("a refused edit is not sent again and the token keeps the typed value", async () => {
    const { sync, scene, edits } = await setup();
    editAtTable(scene, { health: 5 });
    await settle();
    expect(edits()).toHaveLength(1);

    await sync.handleMessage(refusal(edits()[0]!.id));
    await settle();
    scene.addItems([foreign]);
    await settle();

    expect(edits()).toHaveLength(1);
    expect(bubbles(scene).health).toBe(5);
  });

  it("a max HP edit that lowers HP in the store pushes the lowered HP", async () => {
    const { sync, scene, edits, heard } = await setup();
    editAtTable(scene, { "max health": 8 });
    await settle();
    expect(edits().map((e) => e.edit)).toEqual([
      { instanceId: "i1", maxHp: 8 },
    ]);

    // The store lowers HP from 10 to the new max as a side effect.
    await sync.handleMessage(hpChanged(1, 8, 8, tableOf(edits()[0]!.id)));
    await settle();

    expect(bubbles(scene)).toMatchObject({ health: 8, "max health": 8 });
    expect(edits()).toHaveLength(1);
    expect(heard.notes).toEqual([]);
  });
});

describe("createEncounterSync snapshot overrides", () => {
  it("the sync calls onSnapshotOverride once per field a snapshot pushed", async () => {
    const { sync, heard } = await setup();
    expect(heard.overrides).toEqual([]);

    // While the extension was away the store changed HP and max HP.
    await sync.handleMessage(snapshot(inst({ currentHp: 7, maxHp: 12 }), 3));
    await settle();

    expect(heard.overrides).toHaveLength(2);
    for (const text of heard.overrides) expect(text).toContain("Shadow 1");
    expect(heard.overrides.some((t) => t.includes("7"))).toBe(true);
    expect(heard.overrides.some((t) => t.includes("12"))).toBe(true);

    // The same snapshot again pushes nothing, so nothing more is recorded.
    await sync.handleMessage(snapshot(inst({ currentHp: 7, maxHp: 12 }), 3));
    await settle();
    expect(heard.overrides).toHaveLength(2);
  });
});
