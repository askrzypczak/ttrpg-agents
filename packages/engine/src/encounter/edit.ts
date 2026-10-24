import { UnknownInstanceError } from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

/** Absolute values to set on one instance; absent fields are left alone. */
export type InstanceEdit = {
  instanceId: string;
  currentHp?: number;
  maxHp?: number;
  armorClass?: number;
};

/**
 * Applies an edit made at the table: max HP, then HP, then armor class,
 * through the repository's setters (so values are clamped like DM commands).
 * Returns the instance after the edit.
 */
export function applyInstanceEdit(
  repo: EncounterRepository,
  edit: InstanceEdit,
  origin: ChangeOrigin,
): MonsterInstance {
  if (!repo.listInstances().some((i) => i.id === edit.instanceId))
    throw new UnknownInstanceError(`no instance ${edit.instanceId}`);
  if (edit.maxHp !== undefined)
    repo.setMaxHp(edit.instanceId, edit.maxHp, origin);
  if (edit.currentHp !== undefined)
    repo.setHp(edit.instanceId, edit.currentHp, origin);
  if (edit.armorClass !== undefined)
    repo.setArmorClass(edit.instanceId, edit.armorClass, origin);
  return repo.listInstances().find((i) => i.id === edit.instanceId)!;
}
