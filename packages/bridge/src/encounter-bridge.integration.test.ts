import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEncounterEmitter,
  observeRepository,
  type EncounterRepository,
  type MonsterInstance,
  type TokenArtRepository,
} from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import {
  broadcastSnapshotsOnChange,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";

/** A store with no token art. */
const noArt: TokenArtRepository = {
  listTokenArt: () => ({}),
  setTokenArt: () => {},
};

function setup() {
  const inner = new SqliteEncounterRepository(openDatabase(":memory:"));
  const emitter = createEncounterEmitter();
  return { inner, repo: observeRepository(inner, emitter) };
}

describe("snapshotMessage", () => {
  it("contains the current instances", () => {
    const { repo, inner } = setup();
    const created = repo.addInstances(() => [
      { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
    ]);
    expect(snapshotMessage(inner, noArt)).toEqual({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: created },
    });
  });
});

describe("removeInstance", () => {
  const addTwo = (repo: EncounterRepository) =>
    repo.addInstances(() => [
      { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
      { monsterKey: "shadow", displayName: "Shadow 2", maxHp: 16 },
    ]);

  it("removes and returns ok", () => {
    const { inner } = setup();
    const [first, second] = addTwo(inner);
    expect(removeInstance(inner, first!.id)).toEqual({ ok: true });
    expect(inner.listInstances().map((i) => i.id)).toEqual([second!.id]);
  });

  it("maps UnknownInstanceError to unknown-instance", () => {
    const { inner } = setup();
    const before = addTwo(inner);
    const result = removeInstance(inner, "no-such-instance");
    expect(result).toMatchObject({ ok: false, code: "unknown-instance" });
    if (result.ok) return;
    expect(typeof result.message).toBe("string");
    expect(inner.listInstances()).toEqual(before);
  });

  it("rethrows other errors", () => {
    const boom = new Error("disk I/O error");
    const stub: Pick<EncounterRepository, "removeInstances"> = {
      removeInstances: () => {
        throw boom;
      },
    };
    let caught: unknown;
    try {
      removeInstance(stub as EncounterRepository, "i1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
  });
});

describe("broadcastSnapshotsOnChange", () => {
  const INTERVAL = 100;
  const shadow: MonsterInstance = {
    id: "i1",
    encounterId: "e1",
    monsterKey: "shadow",
    displayName: "Shadow 1",
    maxHp: 16,
    currentHp: 16,
    initiative: null,
    groupId: null,
    createdAt: 0,
  };
  const expected: BridgeMessage = {
    v: 1,
    type: "encounter-snapshot",
    payload: { instances: [shadow] },
  };

  let version: number;
  let readVersion: ReturnType<typeof vi.fn<() => number>>;
  let sent: BridgeMessage[];
  let repo: EncounterRepository;
  const target = { broadcast: (m: BridgeMessage) => sent.push(m) };

  beforeEach(() => {
    vi.useFakeTimers();
    version = 1;
    readVersion = vi.fn(() => version);
    sent = [];
    const stub: Pick<EncounterRepository, "listInstances"> = {
      listInstances: () => [shadow],
    };
    repo = stub as EncounterRepository;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts a snapshot when the data version changes", () => {
    const stop = broadcastSnapshotsOnChange(readVersion, repo, noArt, target, {
      intervalMs: INTERVAL,
    });
    version = 2;
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([expected]);
    stop();
  });

  it("broadcasts nothing while the data version is unchanged", () => {
    const stop = broadcastSnapshotsOnChange(readVersion, repo, noArt, target, {
      intervalMs: INTERVAL,
    });
    vi.advanceTimersByTime(INTERVAL * 10);
    expect(readVersion.mock.calls.length).toBeGreaterThan(1);
    expect(sent).toEqual([]);
    stop();
  });

  it("broadcasts once per change, not once per tick", () => {
    const stop = broadcastSnapshotsOnChange(readVersion, repo, noArt, target, {
      intervalMs: INTERVAL,
    });
    version = 2;
    vi.advanceTimersByTime(INTERVAL * 5);
    expect(sent).toEqual([expected]);
    version = 3;
    vi.advanceTimersByTime(INTERVAL * 5);
    expect(sent).toEqual([expected, expected]);
    stop();
  });

  it("stops reading and broadcasting after stop() is called", () => {
    const stop = broadcastSnapshotsOnChange(readVersion, repo, noArt, target, {
      intervalMs: INTERVAL,
    });
    vi.advanceTimersByTime(INTERVAL);
    expect(readVersion).toHaveBeenCalled();
    stop();
    readVersion.mockClear();
    version = 2;
    vi.advanceTimersByTime(INTERVAL * 10);
    expect(readVersion).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("keeps running and broadcasts on a later tick after a failing read", () => {
    const stop = broadcastSnapshotsOnChange(readVersion, repo, noArt, target, {
      intervalMs: INTERVAL,
    });
    version = 2;
    readVersion.mockImplementationOnce(() => {
      throw new Error("database is locked");
    });
    expect(() => vi.advanceTimersByTime(INTERVAL)).not.toThrow();
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([expected]);
    stop();
  });
});
