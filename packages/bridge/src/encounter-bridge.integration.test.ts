import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openScene,
  resolveEncounter,
  type ChangeOrigin,
  type EncounterDirectory,
  type EncounterLog,
  type EncounterRepository,
  type LoggedEvent,
  type TokenArtRepository,
  type UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import {
  SqliteEncounterDirectory,
  SqliteEncounterLog,
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
import {
  broadcastLogEvents,
  createSnapshotSource,
  editInstance,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";

/** A store with no token art. */
const noArt: TokenArtRepository = {
  listTokenArt: () => ({}),
  setTokenArt: () => {},
};

const origin: ChangeOrigin = { source: "table", commandId: "test" };

/** A store with one current encounter: its directory and the encounter's repository. */
function setup(store = openDatabase(":memory:")) {
  const directory = new SqliteEncounterDirectory(store);
  const encounter = resolveEncounter(directory, { writes: true }).encounter;
  const encounterId = encounter.id;
  const repo: SqliteEncounterRepository = new SqliteEncounterRepository(
    store,
    encounterId,
  );
  return { directory, encounterId, encounterName: encounter.name, repo };
}

/** A log that serves whatever is in `events`; `calls` records its reads. */
function stubLog(events: (LoggedEvent | UnreadableLogEntry)[] = []) {
  const calls: string[] = [];
  const log: EncounterLog & {
    events: (LoggedEvent | UnreadableLogEntry)[];
  } = {
    events,
    latestSeq: () => (
      calls.push("latestSeq"),
      events.reduce((max, e) => Math.max(max, e.seq), 0)
    ),
    eventsSince: (seq) => (
      calls.push("eventsSince"),
      events.filter((e) => e.seq > seq)
    ),
  };
  return { log, calls };
}

describe("snapshotMessage", () => {
  it("contains the current instances", () => {
    const { directory, encounterId, encounterName, repo } = setup();
    const created = repo.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 }],
      origin,
    );
    const { log } = stubLog([
      {
        seq: 1,
        encounterId,
        event: { type: "added", instances: created, origin },
      },
      { seq: 2, encounterId, event: { type: "cleared", origin } },
    ]);
    expect(snapshotMessage(directory, noArt, log)).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: created,
        seq: 2,
        encounterId,
        sceneId: null,
        encounterName,
      },
    });
  });

  it("snapshotMessage carries the log's latest seq, read before the instances, and reads the restore seqs after them", () => {
    const { log, calls } = stubLog([
      { seq: 4, encounterId: "e1", event: { type: "cleared", origin } },
    ]);
    const repoStub: Pick<
      EncounterRepository,
      "listInstances" | "listRestoreSeqs"
    > = {
      listInstances: () => (calls.push("listInstances"), []),
      listRestoreSeqs: () => (calls.push("listRestoreSeqs"), {}),
    };
    const directoryStub: Pick<
      EncounterDirectory,
      "getOpenScene" | "getCurrentEncounter" | "repositoryFor"
    > = {
      getOpenScene: () => (calls.push("getOpenScene"), undefined),
      getCurrentEncounter: () => (
        calls.push("getCurrentEncounter"),
        { id: "e1", name: "Encounter 1", createdAt: 0 }
      ),
      repositoryFor: () => repoStub as EncounterRepository,
    };

    const message = snapshotMessage(
      directoryStub as EncounterDirectory,
      noArt,
      log,
    );

    expect(message).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: [],
        seq: 4,
        encounterId: "e1",
        sceneId: null,
        encounterName: "Encounter 1",
      },
    });
    expect(calls).toEqual([
      "latestSeq",
      "getOpenScene",
      "getCurrentEncounter",
      "listInstances",
      "listRestoreSeqs",
    ]);
  });

  it("snapshotMessage carries the restore seq of each restored instance and leaves the field out when none was restored", () => {
    const db = openDatabase(":memory:");
    const { directory, encounterId, encounterName, repo } = setup(db);
    const log = new SqliteEncounterLog(db);
    const [, second, third] = repo.addInstances(
      () => [
        { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
        { monsterKey: "shadow", displayName: "Shadow 2", maxHp: 16 },
        { monsterKey: "shadow", displayName: "Shadow 3", maxHp: 16 },
      ],
      origin,
    );

    expect(snapshotMessage(directory, noArt, log)).toStrictEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: repo.listInstances(),
        seq: log.latestSeq(),
        encounterId,
        sceneId: null,
        encounterName,
      },
    });

    repo.removeInstances([second!.id, third!.id], origin);
    repo.restoreInstances([second!.id], (i) => i.displayName, origin);
    const secondRestore = log.latestSeq();
    repo.restoreInstances([third!.id], (i) => i.displayName, origin);
    const thirdRestore = log.latestSeq();

    expect(snapshotMessage(directory, noArt, log)).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: repo.listInstances(),
        restoreSeqs: {
          [second!.id]: secondRestore,
          [third!.id]: thirdRestore,
        },
        seq: thirdRestore,
        encounterId,
        sceneId: null,
        encounterName,
      },
    });
  });
});

describe("snapshotMessage encounter id", () => {
  it("snapshotMessage carries the current encounter's id", () => {
    const db = openDatabase(":memory:");
    const { directory, encounterId, repo } = setup(db);
    const log = new SqliteEncounterLog(db);
    repo.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 }],
      origin,
    );

    expect(snapshotMessage(directory, noArt, log)).toMatchObject({
      type: "encounter-snapshot",
      payload: { encounterId },
    });
  });

  it("snapshotMessage carries a null encounterId on a store with no encounter, and creates none", () => {
    const db = openDatabase(":memory:");
    const directory = new SqliteEncounterDirectory(db);
    const log = new SqliteEncounterLog(db);

    const message = snapshotMessage(directory, noArt, log);

    expect(message).toMatchObject({
      type: "encounter-snapshot",
      payload: { instances: [], encounterId: null },
    });
    expect(db.prepare("SELECT COUNT(*) AS c FROM encounters").get()).toEqual({
      c: 0,
    });
  });
});

describe("removeInstance", () => {
  const addTwo = (repo: EncounterRepository) =>
    repo.addInstances(
      () => [
        { monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 },
        { monsterKey: "shadow", displayName: "Shadow 2", maxHp: 16 },
      ],
      origin,
    );

  it("removes and returns ok", () => {
    const { directory, repo } = setup();
    const [first, second] = addTwo(repo);
    expect(removeInstance(directory, first!.id, "test")).toEqual({ ok: true });
    expect(repo.listInstances().map((i) => i.id)).toEqual([second!.id]);
  });

  it("maps UnknownInstanceError to unknown-instance", () => {
    const { directory, repo } = setup();
    const before = addTwo(repo);
    const result = removeInstance(directory, "no-such-instance", "test");
    expect(result).toMatchObject({ ok: false, code: "unknown-instance" });
    if (result.ok) return;
    expect(typeof result.message).toBe("string");
    expect(repo.listInstances()).toEqual(before);
  });

  it("rethrows other errors", () => {
    const boom = new Error("disk I/O error");
    const stub: Pick<EncounterRepository, "removeInstances"> = {
      removeInstances: () => {
        throw boom;
      },
    };
    const encounter = { id: "e1", name: "Encounter 1", createdAt: 0 };
    const directoryStub: Pick<
      EncounterDirectory,
      "findEncounterOfInstance" | "repositoryFor"
    > = {
      findEncounterOfInstance: () => encounter,
      repositoryFor: () => stub as EncounterRepository,
    };
    let caught: unknown;
    try {
      removeInstance(directoryStub as EncounterDirectory, "i1", "test");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
  });
});

describe("broadcastLogEvents", () => {
  const POLL_MS = 250;
  const cleared = (seq: number): LoggedEvent => ({
    seq,
    encounterId: "e1",
    event: { type: "cleared", origin },
  });
  const removedEvent = (seq: number, id: string): LoggedEvent => ({
    seq,
    encounterId: "e1",
    event: { type: "removed", id, origin },
  });
  const message = ({
    seq,
    encounterId,
    event,
  }: LoggedEvent): BridgeMessage => ({
    v: PROTOCOL_VERSION,
    type: "encounter-event",
    payload: { ...event, seq, encounterId },
  });

  const unreadable = (seq: number): UnreadableLogEntry => ({
    seq,
    error: "unknown event type",
  });

  let sent: BridgeMessage[];
  const target = { broadcast: (m: BridgeMessage) => sent.push(m) };

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcastLogEvents broadcasts each new log event as an encounter-event with its seq, oldest first", () => {
    const { log } = stubLog();
    const stop = broadcastLogEvents(log, target);

    log.events.push(removedEvent(1, "i1"), cleared(2));
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([message(removedEvent(1, "i1")), message(cleared(2))]);

    log.events.push(cleared(3));
    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([
      message(removedEvent(1, "i1")),
      message(cleared(2)),
      message(cleared(3)),
    ]);
    stop();
  });

  it("broadcastLogEvents starts after the log's latest seq, so events already in the log are not broadcast", () => {
    const { log } = stubLog([cleared(1), cleared(2)]);
    const stop = broadcastLogEvents(log, target);

    vi.advanceTimersByTime(POLL_MS * 2);
    expect(sent).toEqual([]);

    log.events.push(cleared(3));
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([message(cleared(3))]);
    stop();
  });

  it("broadcastLogEvents retries a failing read on the next tick and skips no event", () => {
    const { log } = stubLog();
    const stop = broadcastLogEvents(log, target);
    log.events.push(cleared(1), cleared(2));
    const read = log.eventsSince;
    log.eventsSince = () => {
      log.eventsSince = read;
      throw new Error("database is locked");
    };

    expect(() => vi.advanceTimersByTime(POLL_MS)).not.toThrow();
    expect(sent).toEqual([]);

    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([message(cleared(1)), message(cleared(2))]);
    stop();
  });

  it("broadcastLogEvents passes over an unreadable entry and broadcasts the later events with their own seq", () => {
    const { log } = stubLog();
    const onUnreadable = vi.fn();
    const stop = broadcastLogEvents(log, target, { onUnreadable });

    log.events.push(unreadable(1), cleared(2), cleared(3));
    vi.advanceTimersByTime(POLL_MS * 4);
    expect(onUnreadable).toHaveBeenCalledWith(unreadable(1));
    expect(sent).toEqual([message(cleared(2)), message(cleared(3))]);

    log.events.push(cleared(4));
    vi.advanceTimersByTime(POLL_MS * 2);
    expect(sent).toEqual([
      message(cleared(2)),
      message(cleared(3)),
      message(cleared(4)),
    ]);
    stop();
  });

  it("broadcastLogEvents without a snapshot sends the events after an unreadable entry in the same tick", () => {
    const { log } = stubLog();
    const stop = broadcastLogEvents(log, target);

    log.events.push(unreadable(1), cleared(2));
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([message(cleared(2))]);
    stop();
  });

  it("broadcastLogEvents reports an unreadable entry once with its seq and error, also when it is the newest entry", () => {
    const { log } = stubLog();
    const onUnreadable = vi.fn();
    const stop = broadcastLogEvents(log, target, { onUnreadable });

    log.events.push(cleared(1), unreadable(2));
    vi.advanceTimersByTime(POLL_MS * 10);
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    expect(onUnreadable).toHaveBeenCalledWith(unreadable(2));

    log.events.push(cleared(3));
    vi.advanceTimersByTime(POLL_MS * 4);
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([message(cleared(1)), message(cleared(3))]);
    stop();
  });

  it("broadcastLogEvents broadcasts a snapshot in place of an unreadable entry, also when it is the newest entry", () => {
    const snapshotMsg: BridgeMessage = {
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: [],
        seq: 2,
        encounterId: "e1",
        sceneId: null,
        encounterName: "Encounter 1",
      },
    };
    const { log } = stubLog();
    const stop = broadcastLogEvents(log, target, {
      snapshot: () => snapshotMsg,
    });

    log.events.push(cleared(1), unreadable(2));
    vi.advanceTimersByTime(POLL_MS * 10);
    expect(sent).toEqual([message(cleared(1)), snapshotMsg]);

    sent.length = 0;
    log.events.push(unreadable(3), cleared(4), cleared(5));
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([snapshotMsg]);

    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([
      snapshotMsg,
      message(cleared(4)),
      message(cleared(5)),
    ]);
    stop();
  });

  it("broadcastLogEvents sends each event with its log entry's encounterId, null included", () => {
    const { log } = stubLog();
    const stop = broadcastLogEvents(log, target);
    const fromEncounter: LoggedEvent = {
      seq: 1,
      encounterId: "e1",
      event: { type: "cleared", origin },
    };
    const fromNoEncounter: LoggedEvent = {
      seq: 2,
      encounterId: null,
      event: { type: "removed", id: "i1", origin },
    };

    log.events.push(fromEncounter, fromNoEncounter);
    vi.advanceTimersByTime(POLL_MS);

    expect(sent).toEqual([
      {
        v: PROTOCOL_VERSION,
        type: "encounter-event",
        payload: { type: "cleared", origin, seq: 1, encounterId: "e1" },
      },
      {
        v: PROTOCOL_VERSION,
        type: "encounter-event",
        payload: {
          type: "removed",
          id: "i1",
          origin,
          seq: 2,
          encounterId: null,
        },
      },
    ]);
    stop();
  });

  it("broadcastLogEvents stops reading after stop() is called", () => {
    const { log, calls } = stubLog();
    const stop = broadcastLogEvents(log, target);
    vi.advanceTimersByTime(POLL_MS);
    expect(calls).toContain("eventsSince");

    stop();
    calls.length = 0;
    log.events.push(cleared(1));
    vi.advanceTimersByTime(POLL_MS * 10);

    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("table changes and snapshots with several encounters", () => {
  /** Two named encounters, B current, one shadow in A and one ghoul in B. */
  function twoEncounters() {
    const store = openDatabase(":memory:");
    const directory = new SqliteEncounterDirectory(store);
    const a = directory.createEncounter("Encounter A");
    const b = directory.createEncounter("Encounter B");
    directory.setCurrentEncounter(b.id);
    const repoA = directory.repositoryFor(a.id);
    const repoB = directory.repositoryFor(b.id);
    const [shadow] = repoA.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 }],
      origin,
    );
    const [ghoul] = repoB.addInstances(
      () => [{ monsterKey: "ghoul", displayName: "Ghoul 1", maxHp: 22 }],
      origin,
    );
    return {
      store,
      directory,
      a,
      b,
      repoA,
      repoB,
      shadow: shadow!,
      ghoul: ghoul!,
    };
  }

  it("removeInstance removes the instance from the encounter that holds it while another encounter is current", () => {
    const { directory, b, repoA, repoB, shadow, ghoul } = twoEncounters();

    expect(removeInstance(directory, shadow.id, "remove-1")).toEqual({
      ok: true,
    });

    expect(repoA.listInstances()).toEqual([]);
    expect(repoA.listRemovedInstances()).toEqual([
      {
        instance: shadow,
        removedBy: { source: "table", commandId: "remove-1" },
        cleared: false,
      },
    ]);
    expect(repoB.listInstances()).toEqual([ghoul]);
    expect(directory.getCurrentEncounter()).toEqual(b);
  });

  it("editInstance edits the instance in the encounter that holds it while another encounter is current", () => {
    const { directory, b, repoA, repoB, shadow, ghoul } = twoEncounters();

    expect(
      editInstance(
        directory,
        { instanceId: shadow.id, currentHp: 9, armorClass: 14 },
        "edit-1",
      ),
    ).toEqual({ ok: true });

    expect(repoA.listInstances()).toEqual([
      { ...shadow, currentHp: 9, armorClass: 14 },
    ]);
    expect(repoB.listInstances()).toEqual([ghoul]);
    expect(directory.getCurrentEncounter()).toEqual(b);
  });

  it("snapshotMessage lists only the current encounter's instances and restore seqs, and carries its id", () => {
    const { store, directory, a, b, repoA, repoB, ghoul } = twoEncounters();
    const keepName = (i: { displayName: string }) => i.displayName;
    const log = new SqliteEncounterLog(store);
    const [, ghoul2] = repoB.addInstances(
      () => [
        { monsterKey: "ghoul", displayName: "Ghoul 2", maxHp: 22 },
        { monsterKey: "ghoul", displayName: "Ghoul 3", maxHp: 22 },
      ],
      origin,
    );
    repoB.removeInstances([ghoul2!.id], origin);
    const [restoredB] = repoB.restoreInstances([ghoul2!.id], keepName, origin);
    const restoreSeqB = log.latestSeq();
    const [shadow2] = repoA.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 2", maxHp: 16 }],
      origin,
    );
    repoA.removeInstances([shadow2!.id], origin);
    repoA.restoreInstances([shadow2!.id], keepName, origin);

    const snapshot = snapshotMessage(directory, noArt, log);

    expect(snapshot).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: repoB.listInstances(),
        restoreSeqs: { [restoredB!.id]: restoreSeqB },
        seq: log.latestSeq(),
        encounterId: b.id,
        sceneId: null,
        encounterName: b.name,
      },
    });
    const listed = (
      snapshot.payload as { instances: { id: string; encounterId: string }[] }
    ).instances;
    expect(listed.map((i) => i.encounterId)).toEqual([b.id, b.id, b.id]);
    expect(listed.map((i) => i.id)).toContain(ghoul.id);
    expect(directory.listEncounters()).toEqual([a, b]);
  });
});

describe("snapshots of the open scene", () => {
  /** Encounter A bound to scene s1 with one shadow; encounter B current with one ghoul. */
  function sceneStore() {
    const store = openDatabase(":memory:");
    const directory = new SqliteEncounterDirectory(store);
    const log = new SqliteEncounterLog(store);
    const a = directory.createEncounter("Encounter A");
    const b = directory.createEncounter("Encounter B");
    directory.bindScene("s1", a.id);
    directory.setCurrentEncounter(b.id);
    const repoA = directory.repositoryFor(a.id);
    const repoB = directory.repositoryFor(b.id);
    repoA.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 }],
      origin,
    );
    repoB.addInstances(
      () => [{ monsterKey: "ghoul", displayName: "Ghoul 1", maxHp: 22 }],
      origin,
    );
    return { store, directory, log, a, b, repoA, repoB };
  }

  it("snapshotMessage carries the open scene and its bound encounter's id, name and instances, also while another encounter is current", () => {
    const { directory, log, a, b, repoA } = sceneStore();
    directory.setOpenScene("s1");
    expect(directory.getCurrentEncounter()?.id).toBe(b.id);

    expect(snapshotMessage(directory, noArt, log)).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: repoA.listInstances(),
        seq: log.latestSeq(),
        encounterId: a.id,
        sceneId: "s1",
        encounterName: "Encounter A",
      },
    });
  });

  it("snapshotMessage of an open scene with no encounter carries the scene, a null encounter and no instances", () => {
    const { directory, log, b } = sceneStore();
    directory.setOpenScene("s2");

    expect(snapshotMessage(directory, noArt, log)).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: [],
        seq: log.latestSeq(),
        encounterId: null,
        sceneId: "s2",
        encounterName: null,
      },
    });
    // The snapshot creates and binds nothing.
    expect(directory.getOpenScene()).toEqual({
      sceneId: "s2",
      encounter: undefined,
    });
    expect(directory.getCurrentEncounter()?.id).toBe(b.id);
    expect(directory.listEncounters()).toHaveLength(2);
  });

  it("snapshotMessage with no scene open carries a null scene and the current encounter with its name", () => {
    const { directory, log, b, repoB } = sceneStore();

    expect(snapshotMessage(directory, noArt, log)).toEqual({
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: repoB.listInstances(),
        seq: log.latestSeq(),
        encounterId: b.id,
        sceneId: null,
        encounterName: "Encounter B",
      },
    });
  });

  describe("the poll's scope snapshots", () => {
    const POLL_MS = 250;
    let sent: BridgeMessage[];
    const target = { broadcast: (m: BridgeMessage) => sent.push(m) };
    const snapshots = () =>
      sent.flatMap((m) => (m.type === "encounter-snapshot" ? [m.payload] : []));

    beforeEach(() => {
      vi.useFakeTimers();
      sent = [];
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    type Store = ReturnType<typeof sceneStore>;
    it.each<
      [
        string,
        (s: Store) => void,
        (s: Store) => {
          sceneId: string | null;
          encounterId: string | null;
          encounterName: string | null;
        },
      ]
    >([
      [
        "another writer binds a new encounter to the open scene",
        ({ directory }) => {
          directory.setOpenScene("s2");
        },
        ({ directory }) => {
          const { encounter } = resolveEncounter(directory, { writes: true });
          directory
            .repositoryFor(encounter.id)
            .addInstances(
              () => [{ monsterKey: "orc", displayName: "Orc 1", maxHp: 15 }],
              { source: "mcp", commandId: "add-1" },
            );
          return {
            sceneId: "s2",
            encounterId: encounter.id,
            encounterName: encounter.name,
          };
        },
      ],
      [
        "the encounter is renamed in the store",
        ({ directory }) => {
          directory.setOpenScene("s1");
        },
        ({ store, a }) => {
          store
            .prepare("UPDATE encounters SET name = ? WHERE id = ?")
            .run("Crypt", a.id);
          return { sceneId: "s1", encounterId: a.id, encounterName: "Crypt" };
        },
      ],
      [
        "another scene is opened",
        ({ directory }) => {
          directory.setOpenScene("s1");
        },
        ({ directory }) => {
          directory.setOpenScene("s3");
          return { sceneId: "s3", encounterId: null, encounterName: null };
        },
      ],
    ])(
      "the poll sends a fresh snapshot when the open scene, its encounter or the encounter's name changed since the last snapshot built (%s)",
      (_case, before, change) => {
        const s = sceneStore();
        before(s);
        const source = createSnapshotSource(s.directory, noArt, s.log);
        source.snapshot();
        const stop = broadcastLogEvents(s.log, target, {
          snapshot: source.snapshot,
          scopeChanged: source.changed,
        });
        vi.advanceTimersByTime(POLL_MS * 2);
        expect(snapshots()).toEqual([]);

        const scope = change(s);
        vi.advanceTimersByTime(POLL_MS);

        expect(snapshots()).toEqual([expect.objectContaining(scope)]);
        // The new scope is now the last snapshot built: no further snapshot.
        vi.advanceTimersByTime(POLL_MS * 4);
        expect(snapshots()).toHaveLength(1);
        stop();
      },
    );

    it("the poll sends no snapshot while the scope matches the last snapshot built, including one built after a scene-open", () => {
      const { directory, log, repoA } = sceneStore();
      const source = createSnapshotSource(directory, noArt, log);
      source.snapshot();
      const stop = broadcastLogEvents(log, target, {
        snapshot: source.snapshot,
        scopeChanged: source.changed,
      });
      vi.advanceTimersByTime(POLL_MS * 2);
      expect(source.changed()).toBe(false);

      // A scene-open records the scene and its handler sends a snapshot.
      openScene(directory, "s1");
      expect(source.changed()).toBe(true);
      const sceneSnapshot = source.snapshot();
      expect(sceneSnapshot.payload).toEqual(
        expect.objectContaining({
          sceneId: "s1",
          encounterName: "Encounter A",
        }),
      );
      expect(source.changed()).toBe(false);
      repoA.addInstances(
        () => [{ monsterKey: "shadow", displayName: "Shadow 2", maxHp: 16 }],
        origin,
      );
      vi.advanceTimersByTime(POLL_MS * 4);

      expect(sent.map((m) => m.type)).toEqual(["encounter-event"]);
      expect(snapshots()).toEqual([]);
      stop();
    });
  });
});
