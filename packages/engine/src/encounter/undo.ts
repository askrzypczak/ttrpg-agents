import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
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
  /** Left alone: its before value was none, which cannot be written back. */
  | {
      kind: "kept-no-value";
      field: "position" | "group" | "armorClass";
      instance: MonsterInstance;
    };

export type UndoResult =
  | { kind: "nothing" }
  | { kind: "not-covered"; command: string | null }
  | { kind: "undone"; command: string | null; changes: UndoChange[] };

/**
 * Reverses the active encounter's newest undo record in one repository
 * transaction, writing under `origin`, then forgets the undone command and the
 * undo's own command.
 */
export function undoLastCommand(
  repo: EncounterRepository,
  origin: ChangeOrigin,
): UndoResult {
  void repo;
  void origin;
  throw new Error("not implemented");
}
