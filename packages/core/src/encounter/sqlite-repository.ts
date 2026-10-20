import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EncounterRepository } from "./repository.js";
import type {
  Encounter,
  MonsterInstance,
  NewMonsterInstance,
} from "./types.js";

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
  group_id: string | null;
  created_at: number;
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
    groupId: row.group_id,
    createdAt: row.created_at,
  };
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

  addInstances(items: NewMonsterInstance[]): MonsterInstance[] {
    return this.transaction(() => {
      const encounter = this.getOrCreateActiveEncounter();
      const insert = this.db.prepare(
        `INSERT INTO monster_instances
          (id, encounter_id, monster_key, display_name, max_hp, current_hp, initiative, group_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        const instance: MonsterInstance = {
          id: this.newId(),
          encounterId: encounter.id,
          monsterKey: item.monsterKey,
          displayName: item.displayName,
          maxHp: item.maxHp,
          currentHp: item.maxHp,
          initiative: item.initiative ?? null,
          groupId: item.groupId ?? null,
          createdAt: this.now(),
        };
        insert.run(
          instance.id,
          instance.encounterId,
          instance.monsterKey,
          instance.displayName,
          instance.maxHp,
          instance.currentHp,
          instance.initiative,
          instance.groupId,
          instance.createdAt,
        );
        created.push(instance);
      }
      return created;
    });
  }

  applyDamage(id: string, amount: number): MonsterInstance {
    return this.adjustHp(id, amount, -1);
  }

  applyHealing(id: string, amount: number): MonsterInstance {
    return this.adjustHp(id, amount, 1);
  }

  removeInstance(id: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM monster_instances
         WHERE id = ? AND ${ACTIVE_SCOPE}`,
      )
      .run(id);
    return Number(result.changes) > 0;
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

  private adjustHp(id: string, amount: number, sign: 1 | -1): MonsterInstance {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError(
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
      if (!row) throw new Error(`Unknown monster instance: ${id}`);
      const hp = Math.min(
        row.max_hp,
        Math.max(0, row.current_hp + sign * amount),
      );
      this.db
        .prepare("UPDATE monster_instances SET current_hp = ? WHERE id = ?")
        .run(hp, id);
      return toInstance({ ...row, current_hp: hp });
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
