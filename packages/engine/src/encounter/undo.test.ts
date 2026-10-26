import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { UnknownInstanceError } from "./errors.js";
import type { EncounterEvent } from "./events.js";
import { clampArmorClass, clampHp, resizeMaxHp } from "./hp.js";
import type { ChangeOrigin } from "./origin.js";
import type {
  EncounterRepository,
  RestoreNamer,
  UndoRecord,
} from "./repository.js";
import type { MonsterInstance } from "./types.js";
import { undoLastCommand } from "./undo.js";

const undoOrigin: ChangeOrigin = {
  source: "mcp",
  commandId: "undo-1",
  command: "undo",
};
const commandOrigin: ChangeOrigin = { source: "mcp", commandId: "cmd-1" };
const tableOrigin: ChangeOrigin = { source: "table", commandId: "tbl-1" };

interface Call {
  method: string;
  args: unknown[];
  inTransaction: boolean;
}

/** Calls that are not writes to the encounter. */
const NOT_WRITES = new Set(["latestUndoRecord", "forgetCommands"]);

/**
 * An in-memory repository holding live and removed instances and one undo
 * record; every call it receives is logged with whether a transaction was open.
 */
function fakeRepo(state: {
  live: MonsterInstance[];
  removed?: MonsterInstance[];
  record?: UndoRecord;
}): { repo: EncounterRepository; calls: Call[]; writes: () => Call[] } {
  const live = new Map(state.live.map((i) => [i.id, structuredClone(i)]));
  const removed = new Map(
    (state.removed ?? []).map((i) => [i.id, structuredClone(i)]),
  );
  const calls: Call[] = [];
  let depth = 0;
  const log = (method: string, args: unknown[]): void => {
    calls.push({ method, args, inTransaction: depth > 0 });
  };
  const unexpected = (): never => {
    throw new Error("unexpected call");
  };
  const get = (id: string): MonsterInstance => {
    const found = live.get(id);
    if (!found) throw new UnknownInstanceError(`no instance ${id}`);
    return found;
  };
  const update = (
    id: string,
    patch: Partial<MonsterInstance>,
  ): MonsterInstance => {
    const after = { ...get(id), ...patch };
    live.set(id, after);
    return structuredClone(after);
  };
  const repo: EncounterRepository = {
    getOrCreateActiveEncounter: unexpected,
    addInstances: unexpected,
    applyDamage: unexpected,
    applyHealing: unexpected,
    clearEncounter: unexpected,
    noteCommand: unexpected,
    listInstances: () => [...live.values()].map((i) => structuredClone(i)),
    listRemovedInstances: () =>
      [...removed.values()].map((i) => ({
        instance: structuredClone(i),
        removedBy: tableOrigin,
        cleared: false,
      })),
    removeInstances: (ids, origin) => {
      log("removeInstances", [[...ids], origin]);
      const out = ids.map((id) => get(id));
      for (const i of out) {
        live.delete(i.id);
        removed.set(i.id, i);
      }
      return out.map((i) => structuredClone(i));
    },
    restoreInstances: (ids, name, origin) => {
      log("restoreInstances", [[...ids], name, origin]);
      const namesInUse = [...live.values()].map((i) => i.displayName);
      return ids.map((id) => {
        const found = removed.get(id);
        if (!found) throw new UnknownInstanceError(`no removed ${id}`);
        const back = { ...found, displayName: name(found, namesInUse) };
        removed.delete(id);
        live.set(id, back);
        namesInUse.push(back.displayName);
        return structuredClone(back);
      });
    },
    renameInstance: (id, name, origin) => {
      log("renameInstance", [id, name, origin]);
      return update(id, { displayName: name });
    },
    setInitiative: (id, initiative, origin) => {
      log("setInitiative", [id, initiative, origin]);
      return update(id, { initiative });
    },
    setGroupId: (id, groupId, origin) => {
      log("setGroupId", [id, groupId, origin]);
      return update(id, { groupId });
    },
    setStatsVisible: (id, visible, origin) => {
      log("setStatsVisible", [id, visible, origin]);
      return update(id, { statsVisible: visible });
    },
    setArmorClass: (id, armorClass, origin) => {
      log("setArmorClass", [id, armorClass, origin]);
      return update(id, { armorClass: clampArmorClass(armorClass) });
    },
    setHp: (id, hp, origin) => {
      log("setHp", [id, hp, origin]);
      const before = structuredClone(get(id));
      const after = update(id, { currentHp: clampHp(hp, before.maxHp) });
      return { before, after };
    },
    setMaxHp: (id, maxHp, origin) => {
      log("setMaxHp", [id, maxHp, origin]);
      const before = structuredClone(get(id));
      const after = update(id, resizeMaxHp(before.currentHp, maxHp));
      return { before, after };
    },
    setSpawnPositions: (positions, origin) => {
      log("setSpawnPositions", [structuredClone([...positions]), origin]);
      return positions.map(({ id, spawnPosition }) =>
        update(id, { spawnPosition: { ...spawnPosition } }),
      );
    },
    changeMonsters: (changes, origin) => {
      log("changeMonsters", [structuredClone([...changes]), origin]);
      return changes.map(({ id, ...change }) => update(id, change));
    },
    transaction: (fn) => {
      depth += 1;
      try {
        return fn();
      } finally {
        depth -= 1;
      }
    },
    latestUndoRecord: () => {
      log("latestUndoRecord", []);
      return state.record === undefined
        ? undefined
        : structuredClone(state.record);
    },
    forgetCommands: (ids) => {
      log("forgetCommands", [[...ids]]);
    },
  };
  return {
    repo,
    calls,
    writes: () => calls.filter((c) => !NOT_WRITES.has(c.method)),
  };
}

function record(
  command: string,
  instances: UndoRecord["instances"],
  events: EncounterEvent[],
): UndoRecord {
  return { commandId: commandOrigin.commandId, command, instances, events };
}

function forgotten(calls: Call[]): string[] {
  return calls
    .filter((c) => c.method === "forgetCommands")
    .flatMap((c) => c.args[0] as string[]);
}

describe("undoLastCommand", () => {
  it("undoLastCommand with no undo record returns nothing and writes nothing", () => {
    const wolf = makeTestInstance({ id: "w1", displayName: "Wolf 1" });
    const { repo, calls, writes } = fakeRepo({ live: [wolf] });

    const result = undoLastCommand(repo, undoOrigin);

    expect(result).toEqual({ kind: "nothing" });
    expect(writes()).toEqual([]);
    expect(forgotten(calls)).toEqual([]);
    expect(repo.listInstances()).toEqual([wolf]);
  });

  it("undoLastCommand whose newest record has no instances writes nothing, forgets that record and returns not-covered with its command name", () => {
    const wolf = makeTestInstance({ id: "w1", displayName: "Wolf 1" });
    const { repo, calls, writes } = fakeRepo({
      live: [wolf],
      record: record("set_rooms", [], []),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(result).toEqual({ kind: "not-covered", command: "set_rooms" });
    expect(writes()).toEqual([]);
    expect(forgotten(calls)).toContain(commandOrigin.commandId);
    expect(repo.listInstances()).toEqual([wolf]);
  });

  it("undoLastCommand reads and writes inside one repository transaction and forgets the undone command and its own command id last", () => {
    const before = makeTestInstance({
      id: "w1",
      displayName: "Wolf 1",
      maxHp: 11,
      currentHp: 11,
    });
    const now = { ...before, currentHp: 4 };
    const { repo, calls } = fakeRepo({
      live: [now],
      record: record(
        "apply_damage",
        [{ instanceId: "w1", before }],
        [
          {
            type: "hp-changed",
            id: "w1",
            currentHp: 4,
            maxHp: 11,
            origin: commandOrigin,
          },
        ],
      ),
    });

    undoLastCommand(repo, undoOrigin);

    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      expect(call.inTransaction, call.method).toBe(true);
    }
    expect(calls.map((c) => c.method)).toContain("setHp");
    const last = calls.at(-1);
    expect(last?.method).toBe("forgetCommands");
    expect([...((last?.args[0] as string[]) ?? [])].sort()).toEqual(
      [commandOrigin.commandId, undoOrigin.commandId].sort(),
    );
    expect(forgotten(calls)).toHaveLength(2);
  });

  it("undoLastCommand writes the earlier HP back with setMaxHp then setHp under the undo's origin", () => {
    const before = makeTestInstance({
      id: "w1",
      displayName: "Wolf 1",
      maxHp: 20,
      currentHp: 20,
    });
    const now = { ...before, maxHp: 30, currentHp: 12 };
    const { repo, writes } = fakeRepo({
      live: [now],
      record: record(
        "set_max_hp",
        [{ instanceId: "w1", before }],
        [
          {
            type: "hp-changed",
            id: "w1",
            currentHp: 12,
            maxHp: 30,
            origin: commandOrigin,
          },
        ],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes().map((c) => [c.method, ...c.args])).toEqual([
      ["setMaxHp", "w1", 20, undoOrigin],
      ["setHp", "w1", 20, undoOrigin],
    ]);
    expect(result).toEqual({
      kind: "undone",
      command: "set_max_hp",
      changes: [
        {
          kind: "reverted",
          field: "hp",
          from: now,
          to: { ...now, maxHp: 20, currentHp: 20 },
        },
      ],
    });
    expect(repo.listInstances()).toEqual([before]);
  });

  it("undoLastCommand leaves a field the table changed after the command alone and reports it kept-table", () => {
    const before = makeTestInstance({
      id: "w1",
      displayName: "Wolf 1",
      maxHp: 11,
      currentHp: 11,
      armorClass: 12,
    });
    const now = { ...before, currentHp: 9, armorClass: 15 };
    const { repo, writes } = fakeRepo({
      live: [now],
      record: record(
        "edit",
        [{ instanceId: "w1", before }],
        [
          {
            type: "instance-changed",
            id: "w1",
            changes: { armorClass: 15 },
            origin: commandOrigin,
          },
          {
            type: "hp-changed",
            id: "w1",
            currentHp: 5,
            maxHp: 11,
            origin: commandOrigin,
          },
          {
            type: "hp-changed",
            id: "w1",
            currentHp: 9,
            maxHp: 11,
            origin: tableOrigin,
          },
        ],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes().map((c) => [c.method, ...c.args])).toEqual([
      ["setArmorClass", "w1", 12, undoOrigin],
    ]);
    expect(result.kind).toBe("undone");
    const changes = result.kind === "undone" ? result.changes : [];
    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "kept-table", field: "hp" }),
    );
    expect(changes).toContainEqual({
      kind: "reverted",
      field: "armorClass",
      from: now,
      to: { ...now, armorClass: 12 },
    });
    expect(repo.listInstances()[0]?.currentHp).toBe(9);
  });

  it("undoLastCommand removes an instance the command added and reports it removed", () => {
    const keep = makeTestInstance({ id: "w1", displayName: "Wolf 1" });
    const added = makeTestInstance({ id: "w2", displayName: "Wolf 2" });
    const { repo, writes } = fakeRepo({
      live: [keep, added],
      record: record(
        "add_monsters",
        [{ instanceId: "w2", before: null }],
        [{ type: "added", instances: [added], origin: commandOrigin }],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes().map((c) => [c.method, ...c.args])).toEqual([
      ["removeInstances", ["w2"], undoOrigin],
    ]);
    expect(result).toEqual({
      kind: "undone",
      command: "add_monsters",
      changes: [{ kind: "removed", instance: added }],
    });
    expect(repo.listInstances()).toEqual([keep]);
  });

  it("undoLastCommand restores an instance the command removed under its stored name and reports it restored", () => {
    const wolf = makeTestInstance({ id: "w1", displayName: "Wolf 1" });
    const { repo, writes } = fakeRepo({
      live: [],
      removed: [wolf],
      record: record(
        "remove_monsters",
        [{ instanceId: "w1", before: wolf }],
        [{ type: "removed", id: "w1", origin: commandOrigin }],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    const restores = writes();
    expect(restores.map((c) => c.method)).toEqual(["restoreInstances"]);
    expect(restores[0]?.args[0]).toEqual(["w1"]);
    expect(restores[0]?.args[2]).toEqual(undoOrigin);
    const namer = restores[0]?.args[1] as RestoreNamer;
    expect(namer({ ...wolf, displayName: "Wolf 9" }, [])).toBe("Wolf 1");
    expect(result).toEqual({
      kind: "undone",
      command: "remove_monsters",
      changes: [{ kind: "restored", instance: wolf }],
    });
    expect(repo.listInstances()).toEqual([wolf]);
  });

  it("undoLastCommand leaves an instance removed at the table since the command removed and reports it kept-table existence", () => {
    const before = makeTestInstance({
      id: "w1",
      displayName: "Wolf 1",
      maxHp: 11,
      currentHp: 11,
    });
    const damaged = { ...before, currentHp: 4 };
    const { repo, writes } = fakeRepo({
      live: [],
      removed: [damaged],
      record: record(
        "apply_damage",
        [{ instanceId: "w1", before }],
        [
          {
            type: "hp-changed",
            id: "w1",
            currentHp: 4,
            maxHp: 11,
            origin: commandOrigin,
          },
          { type: "removed", id: "w1", origin: tableOrigin },
        ],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes()).toEqual([]);
    expect(result).toEqual({
      kind: "undone",
      command: "apply_damage",
      changes: [
        {
          kind: "kept-table",
          field: "existence",
          instance: expect.objectContaining({ id: "w1" }) as MonsterInstance,
        },
      ],
    });
    expect(repo.listInstances()).toEqual([]);
  });

  it("undoLastCommand writes a monster type back with changeMonsters, keeping an HP the table changed since", () => {
    const before = makeTestInstance({
      id: "w1",
      monsterKey: "wolf",
      displayName: "Wolf 1",
      maxHp: 11,
      currentHp: 11,
      armorClass: 12,
      initiative: 15,
      footprint: 1,
    });
    const changed = {
      ...before,
      monsterKey: "dire-wolf",
      displayName: "Dire Wolf 1",
      maxHp: 22,
      currentHp: 22,
      armorClass: 14,
      initiative: 13,
      footprint: 2,
    };
    const now = { ...changed, currentHp: 10 };
    const { repo, writes } = fakeRepo({
      live: [now],
      record: record(
        "change_monster_type",
        [{ instanceId: "w1", before }],
        [
          {
            type: "monster-changed",
            id: "w1",
            monsterKey: "dire-wolf",
            displayName: "Dire Wolf 1",
            maxHp: 22,
            currentHp: 22,
            armorClass: 14,
            initiative: 13,
            footprint: 2,
            origin: commandOrigin,
          },
          {
            type: "hp-changed",
            id: "w1",
            currentHp: 10,
            maxHp: 22,
            origin: tableOrigin,
          },
        ],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes().map((c) => [c.method, ...c.args])).toEqual([
      [
        "changeMonsters",
        [
          {
            id: "w1",
            monsterKey: "wolf",
            displayName: "Wolf 1",
            maxHp: 22,
            currentHp: 10,
            armorClass: 12,
            initiative: 15,
            footprint: 1,
          },
        ],
        undoOrigin,
      ],
    ]);
    const changes = result.kind === "undone" ? result.changes : [];
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "reverted", field: "type", from: now }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: "kept-table", field: "hp" }),
    );
    expect(repo.listInstances()).toEqual([
      { ...before, maxHp: 22, currentHp: 10 },
    ]);
  });

  it("undoLastCommand reports a position, group or armor class whose earlier value was none as kept-no-value and writes nothing for it", () => {
    const before = makeTestInstance({
      id: "w1",
      displayName: "Wolf 1",
      spawnPosition: null,
      groupId: null,
      armorClass: null,
    });
    const now = {
      ...before,
      spawnPosition: { x: 75, y: 75 },
      groupId: "g1",
      armorClass: 13,
    };
    const { repo, writes } = fakeRepo({
      live: [now],
      record: record(
        "edit",
        [{ instanceId: "w1", before }],
        [
          {
            type: "position-changed",
            id: "w1",
            spawnPosition: { x: 75, y: 75 },
            origin: commandOrigin,
          },
          {
            type: "instance-changed",
            id: "w1",
            changes: { groupId: "g1" },
            origin: commandOrigin,
          },
          {
            type: "instance-changed",
            id: "w1",
            changes: { armorClass: 13 },
            origin: commandOrigin,
          },
        ],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes()).toEqual([]);
    const changes = result.kind === "undone" ? result.changes : [];
    expect(changes).toHaveLength(3);
    for (const field of ["position", "group", "armorClass"]) {
      expect(changes).toContainEqual(
        expect.objectContaining({ kind: "kept-no-value", field }),
      );
    }
    expect(repo.listInstances()).toEqual([now]);
  });

  it("undoLastCommand writes nothing for a field whose current value already equals its earlier value", () => {
    const before = makeTestInstance({
      id: "w1",
      displayName: "Wolf 1",
      initiative: 15,
    });
    const { repo, writes } = fakeRepo({
      live: [before],
      record: record(
        "set_initiative",
        [{ instanceId: "w1", before }],
        [
          {
            type: "instance-changed",
            id: "w1",
            changes: { initiative: 18 },
            origin: commandOrigin,
          },
        ],
      ),
    });

    const result = undoLastCommand(repo, undoOrigin);

    expect(writes()).toEqual([]);
    expect(result).toEqual({
      kind: "undone",
      command: "set_initiative",
      changes: [],
    });
  });
});
