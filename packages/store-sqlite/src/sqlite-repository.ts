import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  InvalidAmountError,
  InvalidInitiativeError,
  UnknownInstanceError,
  clampArmorClass,
  clampHp,
  encounterEventSchema,
  monsterInstanceSchema,
  resizeMaxHp,
  validateInstanceName,
} from "@ttrpg-agents/engine";
import type {
  ChangeOrigin,
  Encounter,
  EncounterEvent,
  EncounterRepository,
  HpChange,
  InstanceBuilder,
  MonsterChange,
  MonsterInstance,
  Point,
  RemovedInstance,
  RestoreNamer,
  UndoRecord,
} from "@ttrpg-agents/engine";

export interface RepositoryOptions {
  now?: () => number;
  newId?: () => string;
}

interface InstanceRow {
  id: string;
  encounter_id: string;
  monster_key: string;
  display_name: string;
  max_hp: number;
  current_hp: number;
  initiative: number | null;
  armor_class: number | null;
  group_id: string | null;
  created_at: number;
  footprint: number;
  stats_visible: number;
  spawn_x: number | null;
  spawn_y: number | null;
}

interface RemovedRow extends InstanceRow {
  removed_source: ChangeOrigin["source"];
  removed_command_id: string;
  /** 1 when the row's removal is the encounter's last clear; NULL reads as 0. */
  cleared: number | null;
}

/** Live rows of the active encounter; removed rows are out of scope for every per-id mutation. */
const ACTIVE_SCOPE =
  "removed_seq IS NULL AND encounter_id IN (SELECT id FROM encounters WHERE active = 1)";

function toInstance(row: InstanceRow): MonsterInstance {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    monsterKey: row.monster_key,
    displayName: row.display_name,
    maxHp: row.max_hp,
    currentHp: row.current_hp,
    initiative: row.initiative,
    armorClass: row.armor_class,
    groupId: row.group_id,
    createdAt: row.created_at,
    footprint: row.footprint,
    statsVisible: row.stats_visible === 1,
    spawnPosition:
      row.spawn_x === null || row.spawn_y === null
        ? null
        : { x: row.spawn_x, y: row.spawn_y },
  };
}

function unknownMessage(id: string): string {
  return `Unknown monster instance: ${id}`;
}

export class SqliteEncounterRepository implements EncounterRepository {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(db: DatabaseSync, options: RepositoryOptions = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  getOrCreateActiveEncounter(): Encounter {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT id, created_at FROM encounters WHERE active = 1")
        .get() as { id: string; created_at: number } | undefined;
      if (existing) return { id: existing.id, createdAt: existing.created_at };
      const encounter = { id: this.newId(), createdAt: this.now() };
      this.db
        .prepare(
          "INSERT INTO encounters (id, active, created_at) VALUES (?, 1, ?)",
        )
        .run(encounter.id, encounter.createdAt);
      return encounter;
    });
  }

  addInstances(
    build: InstanceBuilder,
    origin: ChangeOrigin,
  ): MonsterInstance[] {
    return this.transaction(() => {
      const encounter = this.getOrCreateActiveEncounter();
      const names = this.listInstances().map((i) => i.displayName);
      const items = build(names);
      const insert = this.db.prepare(
        `INSERT INTO monster_instances
          (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at, footprint, stats_visible, spawn_x, spawn_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const created: MonsterInstance[] = [];
      for (const item of items) {
        if (!Number.isInteger(item.maxHp) || item.maxHp <= 0) {
          throw new RangeError(
            `maxHp must be a positive integer, got ${item.maxHp}`,
          );
        }
        if (
          item.initiative != null &&
          (typeof item.initiative !== "number" ||
            !Number.isInteger(item.initiative))
        ) {
          throw new RangeError(
            `initiative must be an integer or null, got ${String(item.initiative)}`,
          );
        }
        if (
          item.armorClass != null &&
          (!Number.isInteger(item.armorClass) || item.armorClass < 0)
        ) {
          throw new RangeError(
            `armorClass must be a non-negative integer or null, got ${String(item.armorClass)}`,
          );
        }
        const instance: MonsterInstance = {
          id: this.newId(),
          encounterId: encounter.id,
          monsterKey: item.monsterKey,
          displayName: item.displayName,
          maxHp: item.maxHp,
          currentHp: item.maxHp,
          initiative: item.initiative ?? null,
          armorClass: item.armorClass ?? null,
          groupId: item.groupId ?? null,
          createdAt: this.now(),
          footprint: item.footprint ?? 1,
          statsVisible: item.statsVisible ?? false,
          spawnPosition: item.spawnPosition ?? null,
        };
        insert.run(
          instance.id,
          instance.encounterId,
          instance.monsterKey,
          instance.displayName,
          instance.maxHp,
          instance.currentHp,
          instance.initiative,
          instance.armorClass,
          instance.groupId,
          instance.createdAt,
          instance.footprint,
          instance.statsVisible ? 1 : 0,
          instance.spawnPosition?.x ?? null,
          instance.spawnPosition?.y ?? null,
        );
        created.push(instance);
      }
      this.recordBefore(
        origin,
        created.map((i) => ({ id: i.id, before: null })),
      );
      this.record({ type: "added", instances: created, origin });
      return created;
    });
  }

  applyDamage(id: string, amount: number, origin: ChangeOrigin): HpChange {
    return this.adjustHp(id, amount, -1, origin);
  }

  applyHealing(id: string, amount: number, origin: ChangeOrigin): HpChange {
    return this.adjustHp(id, amount, 1, origin);
  }

  removeInstances(
    ids: readonly string[],
    origin: ChangeOrigin,
  ): MonsterInstance[] {
    return this.transaction(() => {
      const existing = this.listInstances();
      const removed = ids.map((id) => {
        const instance = existing.find((i) => i.id === id);
        if (!instance) throw new UnknownInstanceError(unknownMessage(id));
        return instance;
      });
      const mark = this.db.prepare(
        `UPDATE monster_instances
         SET removed_seq = ?, removed_source = ?, removed_command_id = ?
         WHERE id = ?`,
      );
      this.recordBefore(
        origin,
        removed.map((i) => ({ id: i.id, before: i })),
      );
      for (const instance of removed) {
        const seq = this.record({ type: "removed", id: instance.id, origin });
        mark.run(seq, origin.source, origin.commandId, instance.id);
      }
      return removed;
    });
  }

  listRemovedInstances(): RemovedInstance[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, (m.removed_seq = e.cleared_seq) AS cleared FROM monster_instances m
         JOIN encounters e ON e.id = m.encounter_id
         WHERE e.active = 1 AND m.removed_seq IS NOT NULL
         ORDER BY m.removed_seq DESC, m.created_at, m.rowid`,
      )
      .all() as unknown as RemovedRow[];
    return rows.map((row) => ({
      instance: toInstance(row),
      removedBy: {
        source: row.removed_source,
        commandId: row.removed_command_id,
      },
      cleared: row.cleared === 1,
    }));
  }

  restoreInstances(
    ids: readonly string[],
    name: RestoreNamer,
    origin: ChangeOrigin,
  ): MonsterInstance[] {
    return this.transaction(() => {
      const namesInUse = this.listInstances().map((i) => i.displayName);
      const restored = ids.map((id) => {
        const row = this.db
          .prepare(
            `SELECT * FROM monster_instances
             WHERE id = ? AND removed_seq IS NOT NULL
               AND encounter_id IN (SELECT id FROM encounters WHERE active = 1)`,
          )
          .get(id) as InstanceRow | undefined;
        if (!row) throw new UnknownInstanceError(unknownMessage(id));
        this.recordBefore(origin, [{ id, before: toInstance(row) }]);
        const displayName = validateInstanceName(
          name(toInstance(row), namesInUse),
          namesInUse,
        );
        this.db
          .prepare(
            `UPDATE monster_instances
             SET display_name = ?, removed_seq = NULL, removed_source = NULL, removed_command_id = NULL
             WHERE id = ?`,
          )
          .run(displayName, id);
        namesInUse.push(displayName);
        return toInstance({ ...row, display_name: displayName });
      });
      const seq = this.record({ type: "added", instances: restored, origin });
      const mark = this.db.prepare(
        "UPDATE monster_instances SET restored_seq = ? WHERE id = ?",
      );
      for (const instance of restored) mark.run(seq, instance.id);
      return restored;
    });
  }

  renameInstance(
    id: string,
    name: string,
    origin: ChangeOrigin,
  ): MonsterInstance {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      const others = this.listInstances()
        .filter((i) => i.id !== id)
        .map((i) => i.displayName);
      const displayName = validateInstanceName(name, others);
      this.db
        .prepare("UPDATE monster_instances SET display_name = ? WHERE id = ?")
        .run(displayName, id);
      this.record({
        type: "instance-changed",
        id,
        changes: { name: displayName },
        origin,
      });
      return toInstance({ ...row, display_name: displayName });
    });
  }

  setInitiative(
    id: string,
    initiative: number | null,
    origin: ChangeOrigin,
  ): MonsterInstance {
    if (initiative !== null && !Number.isInteger(initiative)) {
      throw new InvalidInitiativeError(
        `initiative must be an integer, got ${String(initiative)}`,
      );
    }
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      this.db
        .prepare("UPDATE monster_instances SET initiative = ? WHERE id = ?")
        .run(initiative, id);
      this.record({
        type: "instance-changed",
        id,
        changes: { initiative },
        origin,
      });
      return toInstance({ ...row, initiative });
    });
  }

  setGroupId(
    id: string,
    groupId: string,
    origin: ChangeOrigin,
  ): MonsterInstance {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      this.db
        .prepare("UPDATE monster_instances SET group_id = ? WHERE id = ?")
        .run(groupId, id);
      this.record({
        type: "instance-changed",
        id,
        changes: { groupId },
        origin,
      });
      return toInstance({ ...row, group_id: groupId });
    });
  }

  setHp(id: string, hp: number, origin: ChangeOrigin): HpChange {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      const currentHp = clampHp(hp, row.max_hp);
      this.db
        .prepare("UPDATE monster_instances SET current_hp = ? WHERE id = ?")
        .run(currentHp, id);
      const after = toInstance({ ...row, current_hp: currentHp });
      this.recordHp(after, origin);
      return {
        before: toInstance(row),
        after,
      };
    });
  }

  setMaxHp(id: string, maxHp: number, origin: ChangeOrigin): HpChange {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      const resized = resizeMaxHp(row.current_hp, maxHp);
      this.db
        .prepare(
          "UPDATE monster_instances SET max_hp = ?, current_hp = ? WHERE id = ?",
        )
        .run(resized.maxHp, resized.currentHp, id);
      const after = toInstance({
        ...row,
        max_hp: resized.maxHp,
        current_hp: resized.currentHp,
      });
      this.recordHp(after, origin);
      return {
        before: toInstance(row),
        after,
      };
    });
  }

  setArmorClass(
    id: string,
    armorClass: number,
    origin: ChangeOrigin,
  ): MonsterInstance {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      const value = clampArmorClass(armorClass);
      this.db
        .prepare("UPDATE monster_instances SET armor_class = ? WHERE id = ?")
        .run(value, id);
      this.record({
        type: "instance-changed",
        id,
        changes: { armorClass: value },
        origin,
      });
      return toInstance({ ...row, armor_class: value });
    });
  }

  setStatsVisible(
    id: string,
    visible: boolean,
    origin: ChangeOrigin,
  ): MonsterInstance {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      const value = visible ? 1 : 0;
      this.db
        .prepare("UPDATE monster_instances SET stats_visible = ? WHERE id = ?")
        .run(value, id);
      this.record({
        type: "instance-changed",
        id,
        changes: { statsVisible: visible },
        origin,
      });
      return toInstance({ ...row, stats_visible: value });
    });
  }

  setSpawnPositions(
    positions: readonly { id: string; spawnPosition: Point | null }[],
    origin: ChangeOrigin,
  ): MonsterInstance[] {
    return this.transaction(() => {
      const existing = this.listInstances();
      const targets = positions.map(({ id, spawnPosition }) => {
        const instance = existing.find((i) => i.id === id);
        if (!instance) throw new UnknownInstanceError(unknownMessage(id));
        return { instance, spawnPosition };
      });
      const update = this.db.prepare(
        `UPDATE monster_instances SET spawn_x = ?, spawn_y = ?
         WHERE id = ? AND ${ACTIVE_SCOPE}`,
      );
      this.recordBefore(
        origin,
        targets.map(({ instance }) => ({ id: instance.id, before: instance })),
      );
      return targets.map(({ instance, spawnPosition }) => {
        const point =
          spawnPosition === null
            ? null
            : { x: spawnPosition.x, y: spawnPosition.y };
        update.run(point?.x ?? null, point?.y ?? null, instance.id);
        this.record({
          type: "position-changed",
          id: instance.id,
          spawnPosition: point,
          origin,
        });
        return { ...instance, spawnPosition: point };
      });
    });
  }

  changeMonsters(
    changes: readonly MonsterChange[],
    origin: ChangeOrigin,
  ): MonsterInstance[] {
    return this.transaction(() => {
      const existing = this.listInstances();
      const given: string[] = [];
      const targets = changes.map((change) => {
        const instance = existing.find((i) => i.id === change.id);
        if (!instance)
          throw new UnknownInstanceError(unknownMessage(change.id));
        const others = existing
          .filter((i) => i.id !== change.id)
          .map((i) => i.displayName);
        const displayName = validateInstanceName(change.displayName, [
          ...others,
          ...given,
        ]);
        given.push(displayName);
        return { instance, change: { ...change, displayName } };
      });
      const update = this.db.prepare(
        `UPDATE monster_instances
         SET monster_key = ?, display_name = ?, max_hp = ?, current_hp = ?,
             armor_class = ?, initiative = ?, footprint = ?
         WHERE id = ? AND ${ACTIVE_SCOPE}`,
      );
      this.recordBefore(
        origin,
        targets.map(({ instance }) => ({ id: instance.id, before: instance })),
      );
      return targets.map(({ instance, change }) => {
        update.run(
          change.monsterKey,
          change.displayName,
          change.maxHp,
          change.currentHp,
          change.armorClass,
          change.initiative,
          change.footprint,
          change.id,
        );
        this.record({
          type: "monster-changed",
          id: change.id,
          monsterKey: change.monsterKey,
          displayName: change.displayName,
          maxHp: change.maxHp,
          currentHp: change.currentHp,
          armorClass: change.armorClass,
          initiative: change.initiative,
          footprint: change.footprint,
          origin,
        });
        return {
          ...instance,
          monsterKey: change.monsterKey,
          displayName: change.displayName,
          maxHp: change.maxHp,
          currentHp: change.currentHp,
          armorClass: change.armorClass,
          initiative: change.initiative,
          footprint: change.footprint,
        };
      });
    });
  }

  clearEncounter(origin: ChangeOrigin): MonsterInstance[] {
    return this.transaction(() => {
      const cleared = this.listInstances();
      const seq = this.record({ type: "cleared", origin });
      if (cleared.length === 0) return [];
      // Undo does not reach past a clear: the removals its records could
      // restore are purged below.
      this.deleteUndoRecords(
        "encounter_id IN (SELECT id FROM encounters WHERE active = 1)",
        [],
      );
      // Earlier removals, an earlier clear's set included, cannot be restored any more.
      this.db
        .prepare(
          `DELETE FROM monster_instances
           WHERE removed_seq IS NOT NULL
             AND encounter_id IN (SELECT id FROM encounters WHERE active = 1)`,
        )
        .run();
      this.db
        .prepare(
          `UPDATE monster_instances
           SET removed_seq = ?, removed_source = ?, removed_command_id = ?
           WHERE ${ACTIVE_SCOPE}`,
        )
        .run(seq, origin.source, origin.commandId);
      this.db
        .prepare("UPDATE encounters SET cleared_seq = ? WHERE active = 1")
        .run(seq);
      return cleared;
    });
  }

  listRestoreSeqs(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT id, restored_seq FROM monster_instances
         WHERE restored_seq IS NOT NULL AND ${ACTIVE_SCOPE}`,
      )
      .all() as unknown as { id: string; restored_seq: number }[];
    return Object.fromEntries(rows.map((row) => [row.id, row.restored_seq]));
  }

  listInstances(): MonsterInstance[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM monster_instances m
         JOIN encounters e ON e.id = m.encounter_id
         WHERE e.active = 1 AND m.removed_seq IS NULL
         ORDER BY m.created_at, m.rowid`,
      )
      .all() as unknown as InstanceRow[];
    return rows.map(toInstance);
  }

  private adjustHp(
    id: string,
    amount: number,
    sign: 1 | -1,
    origin: ChangeOrigin,
  ): HpChange {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new InvalidAmountError(
        `amount must be a non-negative integer, got ${amount}`,
      );
    }
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM monster_instances
           WHERE id = ? AND ${ACTIVE_SCOPE}`,
        )
        .get(id) as InstanceRow | undefined;
      if (!row) throw new UnknownInstanceError(unknownMessage(id));
      this.recordBefore(origin, [{ id, before: toInstance(row) }]);
      const hp = Math.min(
        row.max_hp,
        Math.max(0, row.current_hp + sign * amount),
      );
      this.db
        .prepare("UPDATE monster_instances SET current_hp = ? WHERE id = ?")
        .run(hp, id);
      const after = toInstance({ ...row, current_hp: hp });
      this.recordHp(after, origin);
      return {
        before: toInstance(row),
        after,
      };
    });
  }

  /**
   * Appends an event to the change log and returns its seq; call it inside the
   * mutation's transaction. The origin is logged without its command name.
   */
  private record(event: EncounterEvent): number {
    const { source, commandId } = event.origin;
    const logged = { ...event, origin: { source, commandId } };
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO encounter_events (event) VALUES (?)")
      .run(JSON.stringify(logged));
    return Number(lastInsertRowid);
  }

  /** Records the HP values an instance has after a change. */
  private recordHp(after: MonsterInstance, origin: ChangeOrigin): void {
    this.record({
      type: "hp-changed",
      id: after.id,
      currentHp: after.currentHp,
      maxHp: after.maxHp,
      origin,
    });
  }

  /**
   * Keeps, for an `mcp` origin, the command's undo record (its name and the
   * change-log seq before its first write) and each given instance's state
   * before the command's first write to it (null: the command adds it).
   * Insert-if-absent, so a later write in the same command keeps the first
   * state. Call it inside the mutation's transaction, before its event.
   */
  private recordBefore(
    origin: ChangeOrigin,
    instances: readonly { id: string; before: MonsterInstance | null }[],
  ): void {
    if (origin.source !== "mcp") return;
    const encounter = this.getOrCreateActiveEncounter();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO undo_commands (command_id, encounter_id, command, base_seq)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) FROM encounter_events))`,
      )
      .run(origin.commandId, encounter.id, origin.command ?? null);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO undo_instances (command_id, instance_id, before)
       VALUES (?, ?, ?)`,
    );
    for (const { id, before } of instances) {
      insert.run(
        origin.commandId,
        id,
        before === null ? null : JSON.stringify(before),
      );
    }
  }

  /** Deletes the undo records of the commands matching `where` (on undo_commands). */
  private deleteUndoRecords(where: string, params: readonly string[]): void {
    this.db
      .prepare(
        `DELETE FROM undo_instances WHERE command_id IN
           (SELECT command_id FROM undo_commands WHERE ${where})`,
      )
      .run(...params);
    this.db.prepare(`DELETE FROM undo_commands WHERE ${where}`).run(...params);
  }

  noteCommand(origin: ChangeOrigin): void {
    this.transaction(() => {
      this.recordBefore(origin, []);
    });
  }

  latestUndoRecord(): UndoRecord | undefined {
    const command = this.db
      .prepare(
        `SELECT c.command_id, c.command, c.base_seq FROM undo_commands c
         JOIN encounters e ON e.id = c.encounter_id
         WHERE e.active = 1
         ORDER BY c.rowid DESC LIMIT 1`,
      )
      .get() as
      | { command_id: string; command: string | null; base_seq: number }
      | undefined;
    if (!command) return undefined;
    const instanceRows = this.db
      .prepare(
        `SELECT instance_id, before FROM undo_instances
         WHERE command_id = ? ORDER BY rowid`,
      )
      .all(command.command_id) as unknown as {
      instance_id: string;
      before: string | null;
    }[];
    const instances: UndoRecord["instances"] = [];
    for (const row of instanceRows) {
      if (row.before === null) {
        instances.push({ instanceId: row.instance_id, before: null });
        continue;
      }
      const parsed = monsterInstanceSchema.safeParse(JSON.parse(row.before));
      if (parsed.success) {
        instances.push({ instanceId: row.instance_id, before: parsed.data });
      }
    }
    // CASE guards json_extract from rows that are not valid JSON.
    const eventRows = this.db
      .prepare(
        `SELECT event FROM (
           SELECT seq, event,
             CASE WHEN json_valid(event) THEN json_extract(event, '$.origin.source') END AS source,
             CASE WHEN json_valid(event) THEN json_extract(event, '$.origin.commandId') END AS command_id
           FROM encounter_events WHERE seq > ?
         )
         WHERE source = 'table' OR (source = 'mcp' AND command_id = ?)
         ORDER BY seq`,
      )
      .all(command.base_seq, command.command_id) as unknown as {
      event: string;
    }[];
    const events: EncounterEvent[] = [];
    for (const row of eventRows) {
      const parsed = encounterEventSchema.safeParse(JSON.parse(row.event));
      if (parsed.success) events.push(parsed.data);
    }
    return {
      commandId: command.command_id,
      command: command.command,
      instances,
      events,
    };
  }

  forgetCommands(commandIds: readonly string[]): void {
    this.transaction(() => {
      for (const id of commandIds) {
        this.deleteUndoRecords("command_id = ?", [id]);
      }
    });
  }

  /** Runs fn in a transaction; nests by joining an already-open one. */
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
