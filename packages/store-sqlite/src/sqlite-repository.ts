import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  InvalidAmountError,
  InvalidInitiativeError,
  UnknownInstanceError,
  clampArmorClass,
  clampHp,
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
  MonsterInstance,
  Point,
  RemovedInstance,
  RestoreNamer,
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
      this.record({ type: "added", instances: restored, origin });
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
    positions: readonly { id: string; spawnPosition: Point }[],
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
      return targets.map(({ instance, spawnPosition }) => {
        update.run(spawnPosition.x, spawnPosition.y, instance.id);
        this.record({
          type: "position-changed",
          id: instance.id,
          spawnPosition: { x: spawnPosition.x, y: spawnPosition.y },
          origin,
        });
        return {
          ...instance,
          spawnPosition: { x: spawnPosition.x, y: spawnPosition.y },
        };
      });
    });
  }

  clearEncounter(origin: ChangeOrigin): MonsterInstance[] {
    return this.transaction(() => {
      const cleared = this.listInstances();
      const seq = this.record({ type: "cleared", origin });
      if (cleared.length === 0) return [];
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

  /** Appends an event to the change log and returns its seq; call it inside the mutation's transaction. */
  private record(event: EncounterEvent): number {
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO encounter_events (event) VALUES (?)")
      .run(JSON.stringify(event));
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

  /** Runs fn in a transaction; nests by joining an already-open one. */
  private transaction<T>(fn: () => T): T {
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
