import type {
  AttackReport,
  CheckFinding,
  DamagePart,
  EntryRef,
  EntryReport,
  Monster,
  MonsterCheck,
  MonsterSection,
  SaveReport,
} from "@ttrpg-agents/engine";
import { signed } from "./statblock.js";

const SECTION_NAMES: Record<MonsterSection, string> = {
  traits: "trait",
  actions: "action",
  bonusActions: "bonus action",
  reactions: "reaction",
  legendaryActions: "legendary action",
};

/** `Bite (action)`. */
function entryLabel(entry: EntryRef): string {
  return `${entry.name} (${SECTION_NAMES[entry.section]})`;
}

/** `6 (1d8 + 2) Piercing plus 3 (1d6) Poison`. */
function damageText(damage: readonly DamagePart[]): string {
  return damage
    .map((part) =>
      part.dice === undefined
        ? `${String(part.average)} ${part.type}`
        : `${String(part.average)} (${part.dice}) ${part.type}`,
    )
    .join(" plus ");
}

/** `melee attack +4, reach 5 ft., 6 (1d8 + 2) Piercing`. */
function attackText(attack: AttackReport): string {
  const parts = [`${attack.kind} attack ${signed(attack.bonus)}`];
  if (attack.reach !== undefined)
    parts.push(`reach ${String(attack.reach)} ft.`);
  if (attack.range !== undefined) {
    const long =
      attack.range.long === undefined ? "" : `/${String(attack.range.long)}`;
    parts.push(`range ${String(attack.range.normal)}${long} ft.`);
  }
  if (attack.damage.length > 0) parts.push(damageText(attack.damage));
  return parts.join(", ");
}

/** `CON save DC 12, failure 7 (2d6) Poison`. */
function saveText(save: SaveReport): string {
  const failure =
    save.failure.length === 0 ? "" : `, failure ${damageText(save.failure)}`;
  return `${save.ability.toUpperCase()} save DC ${String(save.dc)}${failure}`;
}

/** The numbers a rolling entry prints, joined by "; ". */
function rollParts(entry: EntryReport): string[] {
  const parts: string[] = [];
  if (entry.attack) parts.push(attackText(entry.attack));
  parts.push(...entry.saves.map(saveText));
  if (entry.spellcasting?.saveDc !== undefined)
    parts.push(`spell save DC ${String(entry.spellcasting.saveDc)}`);
  if (entry.spellcasting?.attackBonus !== undefined)
    parts.push(`spell attack ${signed(entry.spellcasting.attackBonus)}`);
  if (!entry.attack && entry.saves.length === 0 && entry.dice.length > 0) {
    const dice = entry.dice.map((d) =>
      d.average === undefined ? d.dice : `${String(d.average)} (${d.dice})`,
    );
    parts.push(`dice ${dice.join(", ")}`);
  }
  return parts;
}

function rollLine(entry: EntryReport): string {
  const parts = rollParts(entry);
  return parts.length === 0
    ? `- ${entryLabel(entry)}`
    : `- ${entryLabel(entry)}: ${parts.join("; ")}`;
}

const signedList = (values: readonly number[]): string =>
  values.map(signed).join(", ");

const plainList = (values: readonly number[]): string =>
  values.map(String).join(", ");

/** What a finding is about: its entry, or the field it checks. */
function findingSubject(finding: CheckFinding): string {
  return finding.entry ? `${entryLabel(finding.entry)}: ` : "";
}

function findingLine(finding: CheckFinding): string {
  const at = findingSubject(finding);
  const found = finding.found;
  switch (finding.code) {
    case "damage_average":
      return `- ${at}damage average ${String(found)} for ${finding.dice ?? "its dice"}; expected ${plainList(finding.expected)}`;
    case "attack_bonus":
      return `- ${at}attack bonus ${signed(found)}; expected ${signedList(finding.expected)}`;
    case "save_dc":
      return `- ${at}save DC ${String(found)}; expected ${plainList(finding.expected)}`;
    case "spell_save_dc":
      return `- ${at}spell save DC ${String(found)}; expected ${plainList(finding.expected)}`;
    case "spell_attack_bonus":
      return `- ${at}spell attack bonus ${signed(found)}; expected ${signedList(finding.expected)}`;
    case "save_modifier": {
      const ability = (finding.field ?? "").replace("saves.", "").toUpperCase();
      return `- ${ability} save ${signed(found)}; expected ${signedList(finding.expected)}`;
    }
    case "initiative":
      return `- initiative ${signed(found)}; expected ${signedList(finding.expected)}`;
  }
}

/** The check part of a creature reply: Rolls, Text only and Findings, with the edit_creature line when there are findings. */
export function formatCreatureCheck(check: MonsterCheck): string {
  const rolling = check.entries.filter((e) => e.rolls);
  const textOnly = check.entries.filter((e) => !e.rolls);
  const lines =
    rolling.length === 0
      ? ["Rolls: none"]
      : ["Rolls:", ...rolling.map(rollLine)];
  lines.push(
    textOnly.length === 0
      ? "Text only: none"
      : `Text only: ${textOnly.map(entryLabel).join(", ")}`,
  );
  if (check.findings.length === 0) lines.push("Findings: none");
  else
    lines.push(
      "Findings:",
      ...check.findings.map(findingLine),
      "Fix a finding with edit_creature, or keep the value if the book prints it on purpose.",
    );
  return lines.join("\n");
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
  return {
    key: monster.key,
    monster,
    rolls: check.entries.filter((e) => e.rolls),
    findings: check.findings,
  };
}
