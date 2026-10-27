import type { EncounterEvent } from "./events.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, UndoRecord } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export type UndoField =
  | "existence"
  | "type"
  | "name"
  | "hp"
  | "armorClass"
  | "initiative"
  | "group"
  | "statsVisible"
  | "position";

export type UndoChange =
  /** The command added or restored it; undo removed it (instance as removed). */
  | { kind: "removed"; instance: MonsterInstance }
  /** The command removed it; undo restored it. */
  | { kind: "restored"; instance: MonsterInstance }
  /** Written back; `from` before the undo, `to` after. */
  | {
      kind: "reverted";
      field: Exclude<UndoField, "existence">;
      from: MonsterInstance;
      to: MonsterInstance;
    }
  /** Left alone: changed (or, for `existence`, removed) at the table after the command. */
  | { kind: "kept-table"; field: UndoField; instance: MonsterInstance }
  /** Left alone: its before value (a group or armor class) was none, which cannot be written back. */
  | {
      kind: "kept-no-value";
      field: "group" | "armorClass";
      instance: MonsterInstance;
    };

/** What the next undo would reach: the newest remaining undo record. */
export interface UndoNext {
  /** The command's name (the MCP tool), or null when it had none. */
  command: string | null;
  /** The current names of the record's monsters, in record order. */
  monsters: string[];
  /** False for a map or room change, which undo does not reverse. */
  covered: boolean;
}

export type UndoResult =
  | { kind: "nothing" }
  | { kind: "not-covered"; command: string | null; next: UndoNext | null }
  | {
      kind: "undone";
      command: string | null;
      changes: UndoChange[];
      next: UndoNext | null;
    };

type ValueField = Exclude<UndoField, "existence">;

/** The order in which an instance's fields are written back. */
const FIELD_ORDER: readonly ValueField[] = [
  "type",
  "name",
  "hp",
  "armorClass",
  "initiative",
  "group",
  "statsVisible",
  "position",
];

/** The field each key of an `instance-changed` event changes. */
const INSTANCE_CHANGE_FIELDS = {
  name: "name",
  initiative: "initiative",
  armorClass: "armorClass",
  statsVisible: "statsVisible",
  groupId: "group",
} as const satisfies Record<string, ValueField>;

type InstanceChangeKey = keyof typeof INSTANCE_CHANGE_FIELDS;

/** The fields an event changes on the instance `id`. */
function fieldsChanged(event: EncounterEvent, id: string): UndoField[] {
  switch (event.type) {
    case "added":
      return event.instances.some((i) => i.id === id) ? ["existence"] : [];
    case "cleared":
      return [];
    case "removed":
      return event.id === id ? ["existence"] : [];
    case "hp-changed":
      return event.id === id ? ["hp"] : [];
    case "instance-changed":
      return event.id === id
        ? Object.keys(event.changes).map(
            (key) => INSTANCE_CHANGE_FIELDS[key as InstanceChangeKey],
          )
        : [];
    case "monster-changed":
      return event.id === id ? ["type"] : [];
    case "position-changed":
      return event.id === id ? ["position"] : [];
  }
}

function fieldsChangedBy(
  events: readonly EncounterEvent[],
  id: string,
): Set<UndoField> {
  return new Set(events.flatMap((e) => fieldsChanged(e, id)));
}

/** True when one of `events` is an `added` (or `removed`) event naming `id`. */
function names(
  events: readonly EncounterEvent[],
  type: "added" | "removed",
  id: string,
): boolean {
  return events.some(
    (e) => e.type === type && fieldsChanged(e, id).includes("existence"),
  );
}

function samePoint(
  a: MonsterInstance["spawnPosition"],
  b: MonsterInstance["spawnPosition"],
): boolean {
  return a === null || b === null ? a === b : a.x === b.x && a.y === b.y;
}

/** True when `current` already has `before`'s value for `field`. */
function unchanged(
  field: ValueField,
  current: MonsterInstance,
  before: MonsterInstance,
): boolean {
  switch (field) {
    case "type":
      return current.monsterKey === before.monsterKey;
    case "name":
      return current.displayName === before.displayName;
    case "hp":
      return (
        current.maxHp === before.maxHp && current.currentHp === before.currentHp
      );
    case "armorClass":
      return current.armorClass === before.armorClass;
    case "initiative":
      return current.initiative === before.initiative;
    case "group":
      return current.groupId === before.groupId;
    case "statsVisible":
      return current.statsVisible === before.statsVisible;
    case "position":
      return samePoint(current.spawnPosition, before.spawnPosition);
  }
}

/** What one undo works from: where it writes, and the record's events split by author. */
interface UndoScope {
  repo: EncounterRepository;
  origin: ChangeOrigin;
  /** The undone command's own events. */
  own: EncounterEvent[];
  /** Events made at the table since the command's first write. */
  table: EncounterEvent[];
}

/** The removed instance `id` as the store keeps it, else `fallback`. */
function removedInstance(
  repo: EncounterRepository,
  id: string,
  fallback: MonsterInstance | null,
): MonsterInstance | null {
  return (
    repo.listRemovedInstances().find((r) => r.instance.id === id)?.instance ??
    fallback
  );
}

function undoInstance(
  scope: UndoScope,
  { instanceId: id, before }: UndoRecord["instances"][number],
): UndoChange[] {
  const { repo, origin } = scope;
  const live = repo.listInstances().find((i) => i.id === id);

  if (names(scope.own, "added", id)) {
    if (live) {
      const [removed] = repo.removeInstances([id], origin);
      return removed ? [{ kind: "removed", instance: removed }] : [];
    }
    const instance = removedInstance(repo, id, before);
    return instance
      ? [{ kind: "kept-table", field: "existence", instance }]
      : [];
  }

  if (before === null) return [];

  if (names(scope.own, "removed", id)) {
    const [restored] = repo.restoreInstances(
      [id],
      () => before.displayName,
      origin,
    );
    return restored ? [{ kind: "restored", instance: restored }] : [];
  }

  if (!live) {
    const instance = removedInstance(repo, id, before) ?? before;
    return [{ kind: "kept-table", field: "existence", instance }];
  }

  return revertFields(scope, live, before);
}

/** Writes back each field the command changed on a live instance; the table wins per field. */
function revertFields(
  scope: UndoScope,
  live: MonsterInstance,
  before: MonsterInstance,
): UndoChange[] {
  const { repo, origin } = scope;
  const id = live.id;
  const changed = fieldsChangedBy(scope.own, id);
  const byTable = fieldsChangedBy(scope.table, id);
  const reported = new Set<UndoField>();
  const changes: UndoChange[] = [];
  let current = live;

  const keptTable = (field: UndoField, instance: MonsterInstance): void => {
    reported.add(field);
    changes.push({ kind: "kept-table", field, instance });
  };
  const keptNoValue = (
    field: "group" | "armorClass",
    instance: MonsterInstance,
  ): void => {
    reported.add(field);
    changes.push({ kind: "kept-no-value", field, instance });
  };
  const reverted = (field: ValueField, to: MonsterInstance): void => {
    changes.push({ kind: "reverted", field, from: current, to });
    current = to;
  };

  for (const field of FIELD_ORDER) {
    if (!changed.has(field) || reported.has(field)) continue;
    if (byTable.has(field)) {
      keptTable(field, current);
      continue;
    }
    if (unchanged(field, current, before)) continue;
    switch (field) {
      case "type": {
        // The type comes back with its name, HP, AC, initiative and footprint;
        // HP, AC or initiative changed at the table since keep their values.
        const keepHp = byTable.has("hp");
        const keepArmorClass = byTable.has("armorClass");
        const keepInitiative = byTable.has("initiative");
        const armorClass =
          keepArmorClass || before.armorClass === null
            ? current.armorClass
            : before.armorClass;
        if (armorClass === null) {
          throw new Error(
            `${current.displayName} has no armor class to keep while its type is undone`,
          );
        }
        const [to] = repo.changeMonsters(
          [
            {
              id,
              monsterKey: before.monsterKey,
              displayName: before.displayName,
              maxHp: keepHp ? current.maxHp : before.maxHp,
              currentHp: keepHp ? current.currentHp : before.currentHp,
              armorClass,
              initiative: keepInitiative
                ? current.initiative
                : before.initiative,
              footprint: before.footprint,
            },
          ],
          origin,
        );
        if (!to) break;
        reverted("type", to);
        if (keepHp) keptTable("hp", to);
        if (keepArmorClass) keptTable("armorClass", to);
        else if (before.armorClass === null) keptNoValue("armorClass", to);
        if (keepInitiative) keptTable("initiative", to);
        break;
      }
      case "name":
        reverted("name", repo.renameInstance(id, before.displayName, origin));
        break;
      case "hp": {
        let to = current;
        if (to.maxHp !== before.maxHp) {
          to = repo.setMaxHp(id, before.maxHp, origin).after;
        }
        if (to.currentHp !== before.currentHp) {
          to = repo.setHp(id, before.currentHp, origin).after;
        }
        reverted("hp", to);
        break;
      }
      case "armorClass":
        if (before.armorClass === null) keptNoValue("armorClass", current);
        else
          reverted(
            "armorClass",
            repo.setArmorClass(id, before.armorClass, origin),
          );
        break;
      case "initiative":
        reverted(
          "initiative",
          repo.setInitiative(id, before.initiative, origin),
        );
        break;
      case "group":
        if (before.groupId === null) keptNoValue("group", current);
        else reverted("group", repo.setGroupId(id, before.groupId, origin));
        break;
      case "statsVisible":
        reverted(
          "statsVisible",
          repo.setStatsVisible(id, before.statsVisible, origin),
        );
        break;
      case "position": {
        const [to] = repo.setSpawnPositions(
          [{ id, spawnPosition: before.spawnPosition }],
          origin,
        );
        if (to) reverted("position", to);
        break;
      }
    }
  }
  return changes;
}

/**
 * What the next undo would reach, read after the undone command is forgotten.
 * Each recorded monster is named as it is now: live, else removed, else as it
 * was before the command; one with no name at all is left out.
 */
function nextUndo(repo: EncounterRepository): UndoNext | null {
  const record = repo.latestUndoRecord();
  if (record === undefined) return null;
  const live = repo.listInstances();
  const monsters = record.instances.flatMap(({ instanceId: id, before }) => {
    const name =
      live.find((i) => i.id === id)?.displayName ??
      removedInstance(repo, id, before)?.displayName;
    return name === undefined ? [] : [name];
  });
  return {
    command: record.command,
    covered: record.instances.length > 0,
    monsters,
  };
}

/**
 * Reverses the active encounter's newest undo record in one repository
 * transaction, writing under `origin`, then forgets the undone command and the
 * undo's own command.
 *
 * A record with no instances (a map or room change) is forgotten without a
 * write and reported `not-covered`. Otherwise, per recorded instance in
 * first-write order: one the command added or restored is removed; one it
 * removed is restored under its earlier name; one removed at the table since
 * is left removed. On a live instance each field the command changed is
 * written back to its value before the command, unless the table changed it
 * since (`kept-table`), it already has that value (no change), or that value
 * was none and cannot be written (`kept-no-value`; group and armor class
 * only, since a spawn position of none is written back, clearing it).
 *
 * The `not-covered` and `undone` results carry `next`: what the next undo would
 * reach, read after this undo's forget, or null when no undo record is left.
 */
export function undoLastCommand(
  repo: EncounterRepository,
  origin: ChangeOrigin,
): UndoResult {
  return repo.transaction((): UndoResult => {
    const record = repo.latestUndoRecord();
    if (record === undefined) return { kind: "nothing" };
    if (record.instances.length === 0) {
      repo.forgetCommands([record.commandId]);
      return {
        kind: "not-covered",
        command: record.command,
        next: nextUndo(repo),
      };
    }
    const scope: UndoScope = {
      repo,
      origin,
      own: record.events.filter(
        (e) =>
          e.origin.source === "mcp" && e.origin.commandId === record.commandId,
      ),
      table: record.events.filter((e) => e.origin.source === "table"),
    };
    const changes = record.instances.flatMap((entry) =>
      undoInstance(scope, entry),
    );
    repo.forgetCommands([record.commandId, origin.commandId]);
    return {
      kind: "undone",
      command: record.command,
      changes,
      next: nextUndo(repo),
    };
  });
}
