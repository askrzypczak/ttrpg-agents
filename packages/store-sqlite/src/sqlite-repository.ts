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
  Encounter,
  EncounterRepository,
  HpChange,
  InstanceBuilder,
  MonsterInstance,
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
}

const ACTIVE_SCOPE =
  "encounter_id IN (SELECT id FROM encounters WHERE active = 1)";

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

  addInstances(build: InstanceBuilder): MonsterInstance[] {
    return this.transaction(() => {
      const encounter = this.getOrCreateActiveEncounter();
      const names = this.listInstances().map((i) => i.displayName);
      const items = build(names);
      const insert = this.db.prepare(
        `INSERT INTO monster_instances
          (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, armor_class, group_id, created_at, footprint, stats_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
        created.push(instance);
      }
      return created;
    });
  }

  applyDamage(id: string, amount: number): HpChange {
    return this.adjustHp(id, amount, -1);
  }

  applyHealing(id: string, amount: number): HpChange {
    return this.adjustHp(id, amount, 1);
  }

  removeInstances(ids: readonly string[]): MonsterInstance[] {
    return this.transaction(() => {
      const existing = this.listInstances();
      const removed = ids.map((id) => {
        const instance = existing.find((i) => i.id === id);
        if (!instance) throw new UnknownInstanceError(unknownMessage(id));
        return instance;
      });
      const del = this.db.prepare(
        `DELETE FROM monster_instances WHERE id = ? AND ${ACTIVE_SCOPE}`,
      );
      for (const instance of removed) del.run(instance.id);
      return removed;
    });
  }

  renameInstance(id: string, name: string): MonsterInstance {
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
      return toInstance({ ...row, display_name: displayName });
    });
  }

  setInitiative(id: string, initiative: number): MonsterInstance {
    if (!Number.isInteger(initiative)) {
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
      return toInstance({ ...row, initiative });
    });
  }

  setHp(id: string, hp: number): HpChange {
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
      return {
        before: toInstance(row),
        after: toInstance({ ...row, current_hp: currentHp }),
      };
    });
  }

  setMaxHp(id: string, maxHp: number): HpChange {
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
      return {
        before: toInstance(row),
        after: toInstance({
          ...row,
          max_hp: resized.maxHp,
          current_hp: resized.currentHp,
        }),
      };
    });
  }

  setArmorClass(id: string, armorClass: number): MonsterInstance {
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
      return toInstance({ ...row, armor_class: value });
    });
  }

  setStatsVisible(id: string, visible: boolean): MonsterInstance {
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
      return toInstance({ ...row, stats_visible: value });
    });
  }

  clearEncounter(): void {
    this.db
      .prepare(
        `DELETE FROM monster_instances
         WHERE encounter_id IN (SELECT id FROM encounters WHERE active = 1)`,
      )
      .run();
  }

  listInstances(): MonsterInstance[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM monster_instances m
         JOIN encounters e ON e.id = m.encounter_id
         WHERE e.active = 1
         ORDER BY m.created_at, m.rowid`,
      )
      .all() as unknown as InstanceRow[];
    return rows.map(toInstance);
  }

  private adjustHp(id: string, amount: number, sign: 1 | -1): HpChange {
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
      return {
        before: toInstance(row),
        after: toInstance({ ...row, current_hp: hp }),
      };
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
