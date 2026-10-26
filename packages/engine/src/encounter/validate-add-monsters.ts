import { DomainError } from "../errors.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { AddMonstersGroup } from "./add-monsters.js";

export type AddMonstersErrorCode =
  | "empty"
  | "unknown_monster"
  | "invalid_count"
  | "invalid_hp"
  | "invalid_initiative";

export class AddMonstersError extends DomainError {
  declare readonly code: AddMonstersErrorCode;
  constructor(code: AddMonstersErrorCode, message: string) {
    super(code, message);
    this.name = "AddMonstersError";
  }
}

/** Checks the options and every group; throws AddMonstersError on the first problem. */
export function validateAddMonsters(
  monsters: MonsterIndex,
  groups: readonly AddMonstersGroup[],
  maxGroupCount: number,
  initiative: unknown,
): void {
  if (!Number.isInteger(maxGroupCount) || maxGroupCount < 1) {
    throw new AddMonstersError(
      "invalid_count",
      `maxGroupCount must be a positive integer, got ${String(maxGroupCount)}`,
    );
  }
  if (initiative !== "group" && initiative !== "each") {
    throw new AddMonstersError(
      "invalid_initiative",
      `initiative must be "group" or "each", got ${String(initiative)}`,
    );
  }
  if (groups.length === 0) {
    throw new AddMonstersError("empty", "No monster groups given");
  }
  groups.forEach((group, i) => {
    const where = `Group ${i + 1} (${group.monster})`;
    if (!monsters.byKey.has(group.monster)) {
      throw new AddMonstersError(
        "unknown_monster",
        `${where}: unknown monster "${group.monster}"`,
      );
    }
    if (
      !Number.isInteger(group.count) ||
      group.count < 1 ||
      group.count > maxGroupCount
    ) {
      throw new AddMonstersError(
        "invalid_count",
        `${where}: count must be an integer between 1 and ${String(maxGroupCount)}, got ${String(group.count)}`,
      );
    }
    if (
      group.hp !== undefined &&
      group.hp !== "rolled" &&
      group.hp !== "average"
    ) {
      throw new AddMonstersError(
        "invalid_hp",
        `${where}: hp must be "rolled" or "average", got ${String(group.hp)}`,
      );
    }
  });
}
