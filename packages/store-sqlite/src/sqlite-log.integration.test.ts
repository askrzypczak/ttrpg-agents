import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type {
  ChangeOrigin,
  EncounterEvent,
  LoggedEvent,
  MonsterInstance,
  UnreadableLogEntry,
} from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const origin = (commandId: string): ChangeOrigin => ({
  source: "mcp",
  commandId,
});

let db: DatabaseSync;
let repo: SqliteEncounterRepository;
let log: SqliteEncounterLog;
let first: MonsterInstance;
let second: MonsterInstance;

beforeEach(() => {
  db = openDatabase(":memory:");
  let n = 0;
  let t = 1000;
  repo = new SqliteEncounterRepository(db, {
    newId: () => `id-${++n}`,
    now: () => ++t,
  });
  log = new SqliteEncounterLog(db);
  [first, second] = repo.addInstances(
    () => [
      { monsterKey: "goblin", displayName: "Goblin 1", maxHp: 7 },
      { monsterKey: "goblin", displayName: "Goblin 2", maxHp: 7 },
    ],
    origin("setup"),
  ) as [MonsterInstance, MonsterInstance];
  repo.applyDamage(first.id, 3, origin("setup"));
});

const isEvent = (
  entry: LoggedEvent | UnreadableLogEntry,
): entry is LoggedEvent => "event" in entry;

const eventsAfter = (seq: number): EncounterEvent[] =>
  log
    .eventsSince(seq)
    .filter(isEvent)
    .map((logged) => logged.event);

interface MutationCase {
  name: string;
  run: (o: ChangeOrigin) => EncounterEvent[];
}

const mutations: MutationCase[] = [
  {
    name: "addInstances",
    run: (o) => {
      const instances = repo.addInstances(
        () => [{ monsterKey: "orc", displayName: "Orc 1", maxHp: 15 }],
        o,
      );
      return [{ type: "added", instances, origin: o }];
    },
  },
  {
    name: "removeInstances",
    run: (o) => {
      repo.removeInstances([second.id], o);
      return [{ type: "removed", id: second.id, origin: o }];
    },
  },
  {
    name: "applyDamage",
    run: (o) => {
      const { after } = repo.applyDamage(first.id, 1, o);
      return [
        {
          type: "hp-changed",
          id: first.id,
          currentHp: after.currentHp,
          maxHp: after.maxHp,
          origin: o,
        },
      ];
    },
  },
  {
    name: "applyHealing",
    run: (o) => {
      const { after } = repo.applyHealing(first.id, 2, o);
      return [
        {
          type: "hp-changed",
          id: first.id,
          currentHp: after.currentHp,
          maxHp: after.maxHp,
          origin: o,
        },
      ];
    },
  },
  {
    name: "setHp",
    run: (o) => {
      const { after } = repo.setHp(first.id, 5, o);
      return [
        {
          type: "hp-changed",
          id: first.id,
          currentHp: after.currentHp,
          maxHp: after.maxHp,
          origin: o,
        },
      ];
    },
  },
  {
    name: "setMaxHp",
    run: (o) => {
      const { after } = repo.setMaxHp(first.id, 3, o);
      return [
        {
          type: "hp-changed",
          id: first.id,
          currentHp: after.currentHp,
          maxHp: after.maxHp,
          origin: o,
        },
      ];
    },
  },
  {
    name: "renameInstance",
    run: (o) => {
      repo.renameInstance(first.id, "Boss", o);
      return [
        {
          type: "instance-changed",
          id: first.id,
          changes: { name: "Boss" },
          origin: o,
        },
      ];
    },
  },
  {
    name: "setInitiative",
    run: (o) => {
      repo.setInitiative(first.id, 17, o);
      return [
        {
          type: "instance-changed",
          id: first.id,
          changes: { initiative: 17 },
          origin: o,
        },
      ];
    },
  },
  {
    name: "setGroupId",
    run: (o) => {
      repo.setGroupId(first.id, "group-9", o);
      return [
        {
          type: "instance-changed",
          id: first.id,
          changes: { groupId: "group-9" },
          origin: o,
        },
      ];
    },
  },
  {
    name: "setArmorClass",
    run: (o) => {
      repo.setArmorClass(first.id, 15, o);
      return [
        {
          type: "instance-changed",
          id: first.id,
          changes: { armorClass: 15 },
          origin: o,
        },
      ];
    },
  },
  {
    name: "setStatsVisible",
    run: (o) => {
      repo.setStatsVisible(first.id, true, o);
      return [
        {
          type: "instance-changed",
          id: first.id,
          changes: { statsVisible: true },
          origin: o,
        },
      ];
    },
  },
  {
    name: "clearEncounter",
    run: (o) => {
      repo.clearEncounter(o);
      return [{ type: "cleared", origin: o }];
    },
  },
];

describe("SqliteEncounterLog", () => {
  describe("each mutation records its event with the call's origin", () => {
    it.each(mutations)("$name", ({ name, run }) => {
      const before = log.latestSeq();
      const expected = run({ source: "table", commandId: `cmd-${name}` });
      expect(eventsAfter(before)).toEqual(expected);
    });
  });

  it("removing several instances records one removed event per id, in the order given", () => {
    const before = log.latestSeq();
    const o = origin("remove-many");
    repo.removeInstances([second.id, first.id], o);
    expect(eventsAfter(before)).toEqual([
      { type: "removed", id: second.id, origin: o },
      { type: "removed", id: first.id, origin: o },
    ]);
  });

  it("a mutation that throws records no event", () => {
    const before = log.latestSeq();
    expect(() => repo.applyDamage("missing", 1, origin("bad-1"))).toThrow();
    expect(() => repo.setInitiative(first.id, 1.5, origin("bad-2"))).toThrow();
    expect(() =>
      repo.removeInstances([first.id, "missing"], origin("bad-3")),
    ).toThrow();
    expect(log.latestSeq()).toBe(before);
    expect(log.eventsSince(before)).toEqual([]);
  });

  it("a mutation inside an outer transaction that rolls back records no event", () => {
    const before = log.latestSeq();
    db.exec("BEGIN");
    repo.setHp(first.id, 1, origin("rolled-back"));
    db.exec("ROLLBACK");
    expect(log.latestSeq()).toBe(before);
    expect(log.eventsSince(before)).toEqual([]);
  });

  it("seq strictly increases across mutations", () => {
    repo.setHp(first.id, 1, origin("a"));
    repo.renameInstance(second.id, "Boss", origin("b"));
    repo.removeInstances([first.id], origin("c"));
    repo.clearEncounter(origin("d"));
    const seqs = log.eventsSince(0).map((logged) => logged.seq);
    expect(seqs.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  it("eventsSince returns exactly the events after the given seq, in order", () => {
    repo.setHp(first.id, 1, origin("a"));
    repo.renameInstance(second.id, "Boss", origin("b"));
    repo.setArmorClass(second.id, 12, origin("c"));
    const all = log.eventsSince(0).filter(isEvent);
    const middle = all[all.length - 2]!;
    expect(log.eventsSince(middle.seq)).toEqual([all[all.length - 1]]);
    expect(log.eventsSince(all[all.length - 1]!.seq)).toEqual([]);
    expect(log.eventsSince(all[0]!.seq)).toEqual(all.slice(1));
    expect(
      all.map((logged) => logged.event.origin.commandId).slice(-3),
    ).toEqual(["a", "b", "c"]);
  });

  describe("eventsSince returns a row that does not parse as an unreadable entry with its seq, and the rows after it as events", () => {
    it.each([
      { name: "invalid JSON", raw: "{not json" },
      {
        name: "a JSON event of an unknown type",
        raw: JSON.stringify({ type: "from-the-future", origin: origin("x") }),
      },
    ])("$name", ({ raw }) => {
      const before = log.latestSeq();
      db.prepare("INSERT INTO encounter_events (seq, event) VALUES (?, ?)").run(
        before + 1,
        raw,
      );
      const o = origin("after-bad-row");
      repo.setHp(first.id, 1, o);

      expect(log.eventsSince(before)).toEqual([
        { seq: before + 1, error: expect.stringMatching(/./) },
        {
          seq: before + 2,
          event: expect.objectContaining({ type: "hp-changed", origin: o }),
        },
      ]);
    });
  });

  it("latestSeq is 0 on an empty log and the last event's seq otherwise", () => {
    const empty = new SqliteEncounterLog(openDatabase(":memory:"));
    expect(empty.latestSeq()).toBe(0);
    repo.setHp(first.id, 1, origin("last"));
    const all = log.eventsSince(0);
    expect(all.length).toBeGreaterThan(0);
    expect(log.latestSeq()).toBe(all[all.length - 1]!.seq);
    expect(log.latestSeq()).toBeGreaterThan(0);
  });
});
