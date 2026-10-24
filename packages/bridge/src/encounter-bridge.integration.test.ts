import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChangeOrigin,
  type EncounterLog,
  type EncounterRepository,
  type LoggedEvent,
  type TokenArtRepository,
  type UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import {
  broadcastLogEvents,
  removeInstance,
  snapshotMessage,
} from "./encounter-bridge.js";

/** A store with no token art. */
const noArt: TokenArtRepository = {
  listTokenArt: () => ({}),
  setTokenArt: () => {},
};

const origin: ChangeOrigin = { source: "table", commandId: "test" };

function setup(): SqliteEncounterRepository {
  return new SqliteEncounterRepository(openDatabase(":memory:"));
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
    const repo = setup();
    const created = repo.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 }],
      origin,
    );
    const { log } = stubLog([
      { seq: 1, event: { type: "added", instances: created, origin } },
      { seq: 2, event: { type: "cleared", origin } },
    ]);
    expect(snapshotMessage(repo, noArt, log)).toEqual({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: created, seq: 2 },
    });
  });

  it("snapshotMessage carries the log's latest seq, read before the instances", () => {
    const { log, calls } = stubLog([
      { seq: 4, event: { type: "cleared", origin } },
    ]);
    const repoStub: Pick<EncounterRepository, "listInstances"> = {
      listInstances: () => (calls.push("listInstances"), []),
    };

    const message = snapshotMessage(
      repoStub as EncounterRepository,
      noArt,
      log,
    );

    expect(message).toEqual({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [], seq: 4 },
    });
    expect(calls).toEqual(["latestSeq", "listInstances"]);
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
    const repo = setup();
    const [first, second] = addTwo(repo);
    expect(removeInstance(repo, first!.id, "test")).toEqual({ ok: true });
    expect(repo.listInstances().map((i) => i.id)).toEqual([second!.id]);
  });

  it("maps UnknownInstanceError to unknown-instance", () => {
    const repo = setup();
    const before = addTwo(repo);
    const result = removeInstance(repo, "no-such-instance", "test");
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
    let caught: unknown;
    try {
      removeInstance(stub as EncounterRepository, "i1", "test");
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
    event: { type: "cleared", origin },
  });
  const removedEvent = (seq: number, id: string): LoggedEvent => ({
    seq,
    event: { type: "removed", id, origin },
  });
  const message = ({ seq, event }: LoggedEvent): BridgeMessage => ({
    v: 1,
    type: "encounter-event",
    payload: { ...event, seq },
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
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [], seq: 2 },
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
