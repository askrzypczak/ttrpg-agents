import { describe, expect, it } from "vitest";
import type { MonsterInstance } from "../encounter/types.js";
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
