import type {
  CheckFinding,
  EntryReport,
  Monster,
  MonsterCheck,
} from "@ttrpg-agents/engine";

/** The check part of a creature reply: Rolls, Text only and Findings, with the edit_creature line when there are findings. */
export function formatCreatureCheck(check: MonsterCheck): string {
  void check;
  throw new Error("not implemented");
}

/** A creature reply's structured content. */
export function creatureContent(
  monster: Monster,
  check: MonsterCheck,
): {
  key: string;
  monster: Monster;
  rolls: EntryReport[];
  findings: CheckFinding[];
} {
  void monster;
  void check;
  throw new Error("not implemented");
}
