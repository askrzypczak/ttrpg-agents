import type { Monster, MonsterEntry } from "@ttrpg-agents/engine";

function signed(n: number): string {
  return n >= 0 ? `+${String(n)}` : String(n);
}

function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

function entryLine(entry: MonsterEntry): string {
  const cost =
    entry.cost !== undefined && entry.cost > 1
      ? ` (Costs ${String(entry.cost)})`
      : "";
  return `**${entry.name}${cost}.** ${entry.desc}`;
}

function section(title: string, entries: MonsterEntry[]): string[] {
  if (entries.length === 0) return [];
  return ["", `### ${title}`, ...entries.map(entryLine)];
}

/** Markdown statblock for a monster. */
export function formatStatblock(m: Monster): string {
  const speeds = Object.entries(m.speeds)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k} ${String(v)} ft.`)
    .join(", ");
  const abilities = (["str", "dex", "con", "int", "wis", "cha"] as const).map(
    (a) =>
      `${a.toUpperCase()} ${String(m.abilities[a])} (save ${signed(m.saves[a])})`,
  );
  const skills = Object.entries(m.skills).map(([k, v]) => `${k} ${signed(v)}`);
  const senses = [
    ...Object.entries(m.senses)
      .filter(([k, v]) => k !== "passivePerception" && typeof v === "number")
      .map(([k, v]) => `${k} ${String(v)} ft.`),
    ...(m.senses.passivePerception === undefined
      ? []
      : [`passive Perception ${String(m.senses.passivePerception)}`]),
  ];
  const lines = [
    `## ${m.name} (${m.key})`,
    `*${m.size} ${m.type}, ${m.alignment}*`,
    "",
    `- **AC** ${String(m.ac)}${m.armorDetail ? ` (${m.armorDetail})` : ""}`,
    `- **HP** ${String(m.hp.average)} (${m.hp.dice})`,
    `- **Speed** ${speeds || "none"}`,
    `- **Abilities** ${abilities.join(", ")}`,
    `- **Initiative** ${signed(m.initiativeModifier)}`,
    `- **CR** ${formatCr(m.cr)}`,
  ];
  if (skills.length > 0) lines.push(`- **Skills** ${skills.join(", ")}`);
  if (senses.length > 0) lines.push(`- **Senses** ${senses.join(", ")}`);
  if (m.languages) lines.push(`- **Languages** ${m.languages}`);
  const lists: [string, string[]][] = [
    ["Damage Vulnerabilities", m.damageVulnerabilities],
    ["Damage Resistances", m.damageResistances],
    ["Damage Immunities", m.damageImmunities],
    ["Condition Immunities", m.conditionImmunities],
  ];
  for (const [label, values] of lists) {
    if (values.length > 0) lines.push(`- **${label}** ${values.join(", ")}`);
  }
  lines.push(
    ...section("Traits", m.sections.traits),
    ...section("Actions", m.sections.actions),
    ...section("Bonus Actions", m.sections.bonusActions),
    ...section("Reactions", m.sections.reactions),
    ...section("Legendary Actions", m.sections.legendaryActions),
  );
  return lines.join("\n");
}
