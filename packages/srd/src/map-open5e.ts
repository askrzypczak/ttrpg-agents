// NOTE: only type imports (from @ttrpg-agents/core), so Node can run this file
// directly (type stripping) from scripts/import-srd.ts.
import type { Monster, MonsterEntry } from "@ttrpg-agents/core";

type Abilities = Record<
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma",
  number
>;

interface Open5eNamed {
  name: string;
  key?: string;
}

interface Open5eAction {
  name: string;
  desc: string;
  action_type: "ACTION" | "BONUS_ACTION" | "REACTION" | "LEGENDARY_ACTION";
  order_in_statblock?: number | null;
  legendary_action_cost?: number | null;
  usage_limits?: { type: string; param: number } | null;
  limited_to_form?: string | null;
}

/** The subset of an Open5e v2 creature this project reads. */
export interface Open5eCreature {
  key: string;
  name: string;
  size: { key: string };
  type: { key: string };
  challenge_rating: number;
  speed: {
    walk?: number;
    fly?: number;
    swim?: number;
    climb?: number;
    burrow?: number;
    hover?: boolean;
  };
  alignment: string;
  languages: { as_string: string };
  armor_class: number;
  armor_detail: string;
  hit_points: number;
  hit_dice: string;
  ability_scores: Abilities;
  initiative_bonus: number;
  saving_throws: Abilities;
  skill_bonuses: Record<string, number>;
  passive_perception: number | null;
  darkvision_range: number | null;
  blindsight_range: number | null;
  tremorsense_range: number | null;
  truesight_range: number | null;
  resistances_and_immunities: {
    damage_immunities: Open5eNamed[];
    damage_resistances: Open5eNamed[];
    damage_vulnerabilities: Open5eNamed[];
    condition_immunities: Open5eNamed[];
  };
  actions: Open5eAction[];
  traits: { name: string; desc: string }[];
}

const ABILITY_KEYS = [
  ["str", "strength"],
  ["dex", "dexterity"],
  ["con", "constitution"],
  ["int", "intelligence"],
  ["wis", "wisdom"],
  ["cha", "charisma"],
] as const;

function abilityMap(a: Abilities): Monster["abilities"] {
  const out = {} as Monster["abilities"];
  for (const [short, long] of ABILITY_KEYS) out[short] = a[long];
  return out;
}

function positive(n: number | null | undefined): number | undefined {
  return typeof n === "number" && n > 0 ? n : undefined;
}

function compact<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

function names(list: Open5eNamed[]): string[] {
  return list.map((x) => x.name);
}

function section(
  actions: Open5eAction[],
  type: Open5eAction["action_type"],
): MonsterEntry[] {
  return actions
    .filter((a) => a.action_type === type)
    .sort(
      (a, b) =>
        (a.order_in_statblock ?? 0) - (b.order_in_statblock ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .map((a) => {
      const entry: MonsterEntry = { name: a.name, desc: a.desc };
      if (a.usage_limits) {
        entry.usage = {
          type: a.usage_limits.type,
          param: a.usage_limits.param,
        };
      }
      if (a.limited_to_form) entry.limitedToForm = a.limited_to_form;
      if (type === "LEGENDARY_ACTION") {
        entry.cost = a.legendary_action_cost ?? 1;
      }
      return entry;
    });
}

/** Map an Open5e v2 creature to this project's {@link Monster} (SRD 5.2). */
export function mapOpen5eCreature(c: Open5eCreature): Monster {
  const r = c.resistances_and_immunities;
  return {
    key: c.key,
    name: c.name,
    source: "srd-5.2",
    size: c.size.key,
    type: c.type.key,
    alignment: c.alignment,
    ac: c.armor_class,
    armorDetail: c.armor_detail,
    hp: { average: c.hit_points, dice: c.hit_dice },
    speeds: compact({
      walk: positive(c.speed.walk),
      fly: positive(c.speed.fly),
      swim: positive(c.speed.swim),
      climb: positive(c.speed.climb),
      burrow: positive(c.speed.burrow),
      hover: c.speed.hover ? true : undefined,
    }),
    abilities: abilityMap(c.ability_scores),
    initiativeModifier: c.initiative_bonus,
    cr: c.challenge_rating,
    saves: abilityMap(c.saving_throws),
    skills: { ...c.skill_bonuses },
    senses: compact({
      darkvision: positive(c.darkvision_range),
      blindsight: positive(c.blindsight_range),
      tremorsense: positive(c.tremorsense_range),
      truesight: positive(c.truesight_range),
      passivePerception: c.passive_perception ?? undefined,
    }),
    languages: c.languages.as_string,
    damageVulnerabilities: names(r.damage_vulnerabilities),
    damageResistances: names(r.damage_resistances),
    damageImmunities: names(r.damage_immunities),
    conditionImmunities: names(r.condition_immunities),
    sections: {
      traits: c.traits.map((t) => ({ name: t.name, desc: t.desc })),
      actions: section(c.actions, "ACTION"),
      bonusActions: section(c.actions, "BONUS_ACTION"),
      reactions: section(c.actions, "REACTION"),
      legendaryActions: section(c.actions, "LEGENDARY_ACTION"),
    },
  };
}
