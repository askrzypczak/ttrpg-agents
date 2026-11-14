import { describe, expect, it } from "vitest";
import type { OpenScene } from "../encounter/directory.js";
import type { Encounter, MonsterInstance } from "../encounter/types.js";
import { makeTestInstance } from "../testing/index.js";
import {
  TableUnavailableError,
  getTableStatus,
  type TableArtWait,
  type TablePort,
  type TableSceneStatus,
} from "./index.js";

function inst(i: number): MonsterInstance {
  return makeTestInstance({
    id: `id-${String(i)}`,
    encounterId: "enc",
    monsterKey: "srd-2024_shadow",
    displayName: `Shadow ${String(i)}`,
    maxHp: 10,
    currentHp: 10,
    createdAt: 1000 + i,
  });
}

/** Fake repo holding `count` instances. */
function repoWith(count: number) {
  return {
    listInstances: () => Array.from({ length: count }, (_, i) => inst(i)),
  };
}

/** Fake port answering every call with `status`. */
function tableAnswering(status: TableSceneStatus): TablePort {
  return {
    sceneStatus: () => Promise.resolve(status),
    sceneMap: () => Promise.reject(new Error("not stubbed")),
    sceneTokens: () => Promise.reject(new Error("not stubbed")),
    mapImage: () => Promise.reject(new Error("not stubbed")),
  };
}

const scene = (
  sceneReady: boolean,
  tokenCount: number,
  appliedInstanceCount: number,
  artWaits: TableArtWait[] = [],
): TableSceneStatus => ({
  sceneReady,
  tokenCount,
  appliedInstanceCount,
  artWaits,
});

describe("getTableStatus art waits", () => {
  const ogrePick: TableArtWait = {
    monsterKey: "srd-2024_ogre",
    monsterName: "Ogre",
    step: "pick",
  };
  const wolfReupload: TableArtWait = {
    monsterKey: "srd-2024_wolf",
    monsterName: "Wolf",
    step: "reupload",
  };

  it("getTableStatus passes the table's art waits through", async () => {
    const status = await getTableStatus(
      repoWith(3),
      tableAnswering(scene(true, 1, 3, [ogrePick, wolfReupload])),
    );
    expect(status.artWaits).toEqual([ogrePick, wolfReupload]);
  });

  it("an open pick wait makes the table out of sync even when the counts match", async () => {
    const status = await getTableStatus(
      repoWith(3),
      tableAnswering(scene(true, 3, 3, [ogrePick])),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: false,
      artWaits: [ogrePick],
    });
  });

  it("a re-upload wait alone leaves the table in sync when the counts match", async () => {
    const status = await getTableStatus(
      repoWith(3),
      tableAnswering(scene(true, 3, 3, [wolfReupload])),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: true,
      artWaits: [wolfReupload],
    });
    // Control: the same wait with a pick beside it is out of sync.
    const withPick = await getTableStatus(
      repoWith(3),
      tableAnswering(scene(true, 3, 3, [wolfReupload, ogrePick])),
    );
    expect(withPick.inSync).toBe(false);
  });
});

describe("getTableStatus", () => {
  it("reports in sync, with the full status (`sceneReady`, the three counts, `inSync`), when the scene is ready and token, applied and encounter counts match", async () => {
    const status = await getTableStatus(
      repoWith(3),
      tableAnswering(scene(true, 3, 3)),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: true,
      artWaits: [],
    });
  });

  it("an empty scene and an empty encounter are in sync", async () => {
    const status = await getTableStatus(
      repoWith(0),
      tableAnswering(scene(true, 0, 0)),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 0,
      appliedInstanceCount: 0,
      encounterCount: 0,
      inSync: true,
      artWaits: [],
    });
  });

  it("reports out of sync when the scene is not ready, even if all counts match", async () => {
    const status = await getTableStatus(
      repoWith(2),
      tableAnswering(scene(false, 2, 2)),
    );
    expect(status).toEqual({
      sceneReady: false,
      tokenCount: 2,
      appliedInstanceCount: 2,
      encounterCount: 2,
      inSync: false,
      artWaits: [],
    });
  });

  it("reports out of sync when the token count differs from the applied count", async () => {
    // Token count differs from applied; applied equals the encounter count.
    const status = await getTableStatus(
      repoWith(3),
      tableAnswering(scene(true, 2, 3)),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 2,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: false,
      artWaits: [],
    });
  });

  it("reports out of sync when the applied count differs from the encounter count", async () => {
    // Token and applied counts agree; the encounter has one more.
    const status = await getTableStatus(
      repoWith(4),
      tableAnswering(scene(true, 3, 3)),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 4,
      inSync: false,
      artWaits: [],
    });
  });

  it("lets `TableUnavailableError` from the port propagate", async () => {
    const error = new TableUnavailableError(
      "no Owlbear GM tab is connected to the bridge",
    );
    const table: TablePort = {
      sceneStatus: () => Promise.reject(error),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    };
    let caught: unknown;
    try {
      await getTableStatus(repoWith(1), table);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
  });
});

describe("getTableStatus with the open scene", () => {
  const goblins: Encounter = {
    id: "enc-g",
    name: "Goblin Ambush",
    createdAt: 1,
  };
  const wolves: Encounter = { id: "enc-w", name: "Wolf Pack", createdAt: 2 };

  /**
   * Fake directory: `open` is the store's open scene; each encounter id maps
   * to how many instances its repository lists.
   */
  function directoryWith(
    open: OpenScene | undefined,
    counts: Record<string, number> = {},
  ) {
    return {
      getOpenScene: () => open,
      repositoryFor: (encounterId: string) => ({
        listInstances: () =>
          Array.from({ length: counts[encounterId] ?? 0 }, (_, i) => inst(i)),
      }),
    };
  }

  const held = (
    count: number,
    sceneId: string | null,
    heldEncounterId: string | null,
    extra: Partial<TableSceneStatus> = {},
  ): TableSceneStatus => ({
    ...scene(true, count, count),
    sceneId,
    heldEncounterId,
    ...extra,
  });

  it("getTableStatus compares with the open scene's bound encounter and reports it: in sync when the tab holds that encounter for that scene and the counts match", async () => {
    const open: OpenScene = { sceneId: "scene-1", encounter: goblins };
    const status = await getTableStatus(
      directoryWith(open, { [goblins.id]: 3, [wolves.id]: 5 }),
      tableAnswering(held(3, "scene-1", goblins.id)),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [],
      sceneId: "scene-1",
      heldEncounterId: goblins.id,
      encounterCount: 3,
      inSync: true,
      openScene: open,
      holdsOpenScene: true,
    });
  });

  it("an open scene with no encounter gives no encounter and a count of 0, and is in sync when the tab holds none for that scene and no instance or token", async () => {
    const open: OpenScene = { sceneId: "scene-1", encounter: undefined };
    const status = await getTableStatus(
      directoryWith(open, { [wolves.id]: 2 }),
      tableAnswering(held(0, "scene-1", null)),
    );
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 0,
      appliedInstanceCount: 0,
      artWaits: [],
      sceneId: "scene-1",
      heldEncounterId: null,
      encounterCount: 0,
      inSync: true,
      openScene: open,
      holdsOpenScene: true,
    });
  });

  it("with no scene open getTableStatus reports none and a count of 0, and a tab is out of sync", async () => {
    const status = await getTableStatus(
      directoryWith(undefined, { [goblins.id]: 2 }),
      tableAnswering(held(0, "scene-1", null)),
    );
    expect(status.openScene).toBeUndefined();
    expect(status).toHaveProperty("openScene");
    expect(status.encounterCount).toBe(0);
    expect(status.holdsOpenScene).toBe(false);
    expect(status.inSync).toBe(false);
  });

  it.each([
    ["another encounter for the open scene", "scene-1", wolves.id],
    ["no encounter for the open scene", "scene-1", null],
    ["the open scene's encounter for another scene", "scene-2", goblins.id],
    ["no encounter for another scene", "scene-2", null],
    ["no scene", null, null],
  ])(
    "a tab that holds another encounter, none, or another scene is out of sync even when every count matches (%s)",
    async (_case, sceneId, heldEncounterId) => {
      const open: OpenScene = { sceneId: "scene-1", encounter: goblins };
      const status = await getTableStatus(
        directoryWith(open, { [goblins.id]: 2, [wolves.id]: 2 }),
        tableAnswering(held(2, sceneId, heldEncounterId)),
      );
      expect(status.encounterCount).toBe(2);
      expect(status.holdsOpenScene).toBe(false);
      expect(status.inSync).toBe(false);
    },
  );

  it("our tokens of another encounter or none are passed through and do not make the table out of sync", async () => {
    const open: OpenScene = { sceneId: "scene-1", encounter: goblins };
    const status = await getTableStatus(
      directoryWith(open, { [goblins.id]: 2 }),
      tableAnswering(
        held(2, "scene-1", goblins.id, { unmanagedTokenCount: 4 }),
      ),
    );
    expect(status.unmanagedTokenCount).toBe(4);
    expect(status.holdsOpenScene).toBe(true);
    expect(status.inSync).toBe(true);
  });

  it("a tab that does not report its scene and held encounter gets today's verdict from the counts, with holdsOpenScene unknown", async () => {
    const open: OpenScene = { sceneId: "scene-1", encounter: goblins };
    const directory = directoryWith(open, { [goblins.id]: 3 });

    const matching = await getTableStatus(
      directory,
      tableAnswering(scene(true, 3, 3)),
    );
    expect(matching).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [],
      encounterCount: 3,
      inSync: true,
      openScene: open,
      holdsOpenScene: undefined,
    });

    const differing = await getTableStatus(
      directory,
      tableAnswering(scene(true, 2, 2)),
    );
    expect(differing.holdsOpenScene).toBeUndefined();
    expect(differing.inSync).toBe(false);

    // Only one of the two fields reported still leaves it unknown.
    const sceneOnly = await getTableStatus(
      directory,
      tableAnswering({ ...scene(true, 3, 3), sceneId: "scene-2" }),
    );
    expect(sceneOnly.holdsOpenScene).toBeUndefined();
    expect(sceneOnly.inSync).toBe(true);
  });
});
