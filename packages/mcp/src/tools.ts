import {
  DomainError,
  TargetError,
  addMonstersInRooms,
  changeMonsterType,
  compareByInitiative,
  formatColumnLabel,
  getMapImage,
  getTableStatus,
  listRooms,
  moveMonstersIntoRoom,
  previewMonstersInRooms,
  proposeRooms,
  removeRooms,
  mergeInitiative,
  resetMaxHp,
  resolveTargets,
  restoreEncounter,
  restoreMonsters,
  rollInitiative,
  setRooms,
  splitInitiative,
  getMonsterByKey,
  searchMonsters,
  useMap,
  type ChangeOrigin,
  type MonsterInstance,
  type PreviewInstance,
  type PreviewPlacement,
  type RestoredMonster,
  type RoomPlacement,
} from "@ttrpg-agents/engine";
import { z } from "zod";
import type { ToolContext } from "./context.js";
import { formatStatblock, signed } from "./statblock.js";

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/** A transport-free tool: the server layer only registers these. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations?: ToolAnnotations;
  /** Validates `args` against `inputSchema`; domain errors become isError results. */
  handler(ctx: ToolContext, args: unknown): ToolResult | Promise<ToolResult>;
}

/** The origin of every write in one tool call: source `mcp`, one command id per call. */
function mcpOrigin(ctx: ToolContext): ChangeOrigin {
  return { source: "mcp", commandId: ctx.newCommandId() };
}

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text }] };
  if (structured) result.structuredContent = structured;
  return result;
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  inputSchema: S;
  annotations?: ToolAnnotations;
  run(
    ctx: ToolContext,
    args: z.infer<z.ZodObject<S>>,
  ): ToolResult | Promise<ToolResult>;
}): ToolDefinition {
  const schema = z.object(def.inputSchema);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    handler(ctx, args) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        return fail(`Invalid arguments: ${issues}`);
      }
      const domainErrorToResult = (e: unknown): ToolResult => {
        if (e instanceof DomainError) {
          return fail(e.message);
        }
        throw e;
      };
      try {
        const result = def.run(ctx, parsed.data);
        return result instanceof Promise
          ? result.catch(domainErrorToResult)
          : result;
      } catch (e) {
        return domainErrorToResult(e);
      }
    },
  };
}

function cell(value: string | number | null): string {
  return String(value ?? "-").replaceAll("|", "\\|");
}

function table(headers: string[], rows: (string | number | null)[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function instanceView(i: MonsterInstance): Record<string, unknown> {
  return {
    id: i.id,
    name: i.displayName,
    monsterKey: i.monsterKey,
    hp: i.currentHp,
    maxHp: i.maxHp,
    initiative: i.initiative,
    armorClass: i.armorClass,
  };
}

const searchMonstersTool = defineTool({
  name: "search_monsters",
  annotations: { readOnlyHint: true },
  description:
    "Search monsters by name (case-insensitive, plural-tolerant). Returns up to 10 matches with their keys.",
  inputSchema: { query: z.string() },
  run(ctx, { query }) {
    const matches = searchMonsters(ctx.monsters, query).slice(0, 10);
    if (matches.length === 0) {
      return ok(`No monsters match "${query}".`, { results: [] });
    }
    return ok(
      table(
        ["key", "name", "CR", "source"],
        matches.map((m) => [m.key, m.name, m.cr, m.source]),
      ),
      {
        results: matches.map((m) => ({
          key: m.key,
          name: m.name,
          cr: m.cr,
          source: m.source,
        })),
      },
    );
  },
});

const getStatblockTool = defineTool({
  name: "get_statblock",
  annotations: { readOnlyHint: true },
  description: "Get the full statblock of a monster by its exact key.",
  inputSchema: { key: z.string() },
  run(ctx, { key }) {
    const monster = getMonsterByKey(ctx.monsters, key);
    if (!monster) {
      return fail(
        `Unknown monster "${key}". Use search_monsters to find keys.`,
      );
    }
    return ok(formatStatblock(monster), { monster });
  },
});

/** The add_monsters input, shared with preview_monsters so the same arguments validate the same way. */
const addMonstersInput = {
  groups: z.array(
    z.object({
      monster: z.string().describe("Monster key, e.g. srd-2024_shadow"),
      count: z.number().int().min(1),
      hp: z.enum(["rolled", "average"]).optional(),
      statsVisible: z
        .boolean()
        .optional()
        .describe(
          "Players can see the Stat Bubbles (HP/AC); default false, GM-only",
        ),
      room: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A saved room of the map in use, by name (any case); its monsters are placed on free cells in that room. Needs the bridge running.",
        ),
      join: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A monster already in the encounter, by id or exact name: this group's monsters join its initiative group and take its current initiative (no roll), and its stats visibility unless statsVisible is set",
        ),
    }),
  ),
  initiative: z
    .enum(["group", "each"])
    .optional()
    .describe(
      "One roll per group (default) or per monster; a group with join rolls none",
    ),
};

const addMonstersTool = defineTool({
  name: "add_monsters",
  annotations: { destructiveHint: false },
  description:
    "Add groups of monsters to the encounter in one call. Rolls HP (or uses average) and initiative, and numbers names automatically. A group's optional room places its monsters on free cells of that saved room of the map in use (needs the bridge running). A group's optional join names a monster already in the encounter (id or exact name): its monsters join that monster's initiative group and take its current initiative, without a roll.",
  inputSchema: addMonstersInput,
  async run(ctx, { groups, initiative }) {
    const result = await addMonstersInRooms(
      {
        repo: ctx.repo,
        monsters: ctx.monsters,
        rng: ctx.rng,
        now: ctx.now,
        newGroupId: ctx.newGroupId,
        table: ctx.table,
        maps: ctx.maps,
      },
      groups,
      mcpOrigin(ctx),
      initiative === undefined ? {} : { initiative },
    );
    const text = [
      table(
        ["id", "name", "AC", "HP", "initiative"],
        result.instances.map((i) => [
          i.id,
          i.name,
          i.ac,
          i.maxHp,
          i.initiative,
        ]),
      ),
      ...placementLines(result.placements, result.instances).flatMap((line) => [
        "",
        line,
      ]),
      ...(result.moved ? ["", movedLine] : []),
      ...(result.rolls.length > 0
        ? [
            "",
            "Rolls:",
            ...result.rolls.map(
              (r) =>
                `- ${r.label ?? r.expression}: ${r.expression} = ${String(r.total)}`,
            ),
          ]
        : []),
    ].join("\n");
    return ok(text, {
      instances: result.instances,
      rolls: result.rolls,
      placements: result.placements,
      moved: result.moved,
    });
  },
});

const previewMonstersTool = defineTool({
  name: "preview_monsters",
  annotations: { readOnlyHint: true },
  description:
    "Preview an add_monsters call without adding anything: same groups and initiative, same checks. Returns each would-be monster's name, AC, average HP with its dice, initiative modifier (or, for a group with join, that monster's initiative) and footprint; with a room, the cells they would take or which would not fit (needs the bridge running). Nothing is stored or rolled.",
  inputSchema: addMonstersInput,
  async run(ctx, { groups, initiative }) {
    const preview = await previewMonstersInRooms(
      {
        repo: ctx.repo,
        monsters: ctx.monsters,
        table: ctx.table,
        maps: ctx.maps,
      },
      groups,
      initiative === undefined ? {} : { initiative },
    );
    const text = [
      "Preview only: nothing was added or rolled.",
      "",
      table(
        ["name", "AC", "HP", "initiative", "footprint"],
        preview.instances.map((i) => [
          i.name,
          i.ac,
          `${String(i.averageHp)} (${i.hpDice})`,
          i.joins === null
            ? signed(i.initiativeModifier)
            : `${String(i.joins.initiative ?? "-")} (joins ${i.joins.name})`,
          `${String(i.footprint)} x ${String(i.footprint)}`,
        ]),
      ),
      ...previewPlacementLines(preview.placements, preview.instances).flatMap(
        (line) => ["", line],
      ),
      ...(preview.moved ? ["", movedLine] : []),
    ].join("\n");
    return ok(text, {
      instances: preview.instances,
      placements: preview.placements,
      moved: preview.moved,
    });
  },
});

const moveMonstersTool = defineTool({
  name: "move_monsters",
  annotations: { destructiveHint: true },
  description:
    "Move existing monsters, by instance id or exact name, into a saved room of the map in use: each gets a free cell there and its token moves on the table, keeping its id, HP, initiative and name. All targets must resolve, otherwise nothing is moved. Monsters left without a free cell stay where they are. Needs the bridge running.",
  inputSchema: {
    targets: z.array(z.string()).min(1),
    room: z
      .string()
      .min(1)
      .describe("A saved room of the map in use, by name (any case)."),
  },
  async run(ctx, { targets, room }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was moved.`);
      }
      throw e;
    }
    const result = await moveMonstersIntoRoom(
      { repo: ctx.repo, table: ctx.table, maps: ctx.maps },
      resolved.map((i) => i.id),
      room,
      mcpOrigin(ctx),
    );
    return ok(
      withMovedLine(moveLines(result.placements).join("\n\n"), result.moved),
      { placements: result.placements, moved: result.moved },
    );
  },
});

const listEncounterTool = defineTool({
  name: "list_encounter",
  annotations: { readOnlyHint: true },
  description:
    "List the encounter in initiative order (highest first), with each monster's AC, HP and initiative.",
  inputSchema: {},
  run(ctx) {
    const instances = ctx.repo.listInstances().sort(compareByInitiative);
    const restorable = ctx.repo.listRemovedInstances();
    const removed = restorable.filter((r) => !r.cleared).map((r) => r.instance);
    const cleared = restorable.filter((r) => r.cleared).map((r) => r.instance);
    const body =
      instances.length === 0
        ? "The encounter is empty."
        : table(
            ["id", "name", "AC", "HP", "initiative"],
            instances.map((i) => [
              i.id,
              i.displayName,
              i.armorClass,
              `${String(i.currentHp)}/${String(i.maxHp)}`,
              i.initiative,
            ]),
          );
    const removedLine =
      removed.length === 0
        ? []
        : [
            `Removed, can be restored: ${removed.map((i) => i.displayName).join(", ")}.`,
          ];
    const clearedLine = clearedListLine(cleared);
    return ok([body, ...removedLine, ...clearedLine].join("\n\n"), {
      instances: instances.map(instanceView),
      removed: removed.map(instanceView),
      cleared: cleared.map(instanceView),
    });
  },
});

function hpTool(kind: "damage" | "heal"): ToolDefinition {
  const damage = kind === "damage";
  return defineTool({
    name: damage ? "apply_damage" : "heal",
    description: damage
      ? "Apply damage to a monster (HP clamped at 0). Target is an instance id or exact name."
      : "Heal a monster (HP clamped at max). Target is an instance id or exact name.",
    inputSchema: { target: z.string(), amount: z.number().int().min(0) },
    run(ctx, { target, amount }) {
      const [instance] = resolveTargets(ctx.repo.listInstances(), [target]);
      if (!instance) return fail(`Unknown target "${target}"`);
      const origin = mcpOrigin(ctx);
      const { before, after } = damage
        ? ctx.repo.applyDamage(instance.id, amount, origin)
        : ctx.repo.applyHealing(instance.id, amount, origin);
      return ok(
        `${after.displayName}: ${String(before.currentHp)} -> ${String(after.currentHp)}/${String(after.maxHp)} HP`,
        { instance: instanceView(after) },
      );
    },
  });
}

const setHpTool = defineTool({
  name: "set_hp",
  annotations: { destructiveHint: true },
  description:
    "Set a monster's current HP to an exact value (clamped to 0..max HP). Target is an instance id or exact name.",
  inputSchema: { target: z.string(), hp: z.number().int() },
  run(ctx, { target, hp }) {
    const [instance] = resolveTargets(ctx.repo.listInstances(), [target]);
    // Defensive: resolveTargets throws for an unknown target.
    if (!instance) return fail(`Unknown target "${target}"`);
    const { before, after } = ctx.repo.setHp(instance.id, hp, mcpOrigin(ctx));
    return ok(
      `${after.displayName}: HP ${String(before.currentHp)} -> ${String(after.currentHp)}/${String(after.maxHp)}`,
      { instance: instanceView(after), before: instanceView(before) },
    );
  },
});

const setMaxHpTool = defineTool({
  name: "set_max_hp",
  annotations: { destructiveHint: true },
  description:
    "Set a monster's max HP to an exact value (at least 1); current HP is lowered if above the new max, never raised. Target is an instance id or exact name.",
  inputSchema: { target: z.string(), maxHp: z.number().int() },
  run(ctx, { target, maxHp }) {
    const [instance] = resolveTargets(ctx.repo.listInstances(), [target]);
    // Defensive: resolveTargets throws for an unknown target.
    if (!instance) return fail(`Unknown target "${target}"`);
    const { before, after } = ctx.repo.setMaxHp(
      instance.id,
      maxHp,
      mcpOrigin(ctx),
    );
    return ok(
      `${after.displayName}: max HP ${String(before.maxHp)} -> ${String(after.maxHp)}, HP ${String(before.currentHp)} -> ${String(after.currentHp)}/${String(after.maxHp)}`,
      { instance: instanceView(after), before: instanceView(before) },
    );
  },
});

const resetMaxHpTool = defineTool({
  name: "reset_max_hp",
  annotations: { destructiveHint: true },
  description:
    "Set monsters' max HP to their statblock average (hp average) or a new roll of their HP dice (hp rolled). A monster at full HP stays at full HP; a damaged one keeps its current HP, lowered to the new max if above it. Targets are instance ids or exact names. All targets must resolve, otherwise nothing changes.",
  inputSchema: {
    targets: z.array(z.string()).min(1),
    hp: z.enum(["average", "rolled"]),
  },
  run(ctx, { targets, hp }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was changed.`);
      }
      throw e;
    }
    const result = resetMaxHp(
      { repo: ctx.repo, monsters: ctx.monsters, rng: ctx.rng, now: ctx.now },
      resolved.map((i) => i.id),
      hp,
      mcpOrigin(ctx),
    );
    const lines = result.instances.map(
      ({ before, after }) =>
        `${after.displayName}: max HP ${String(before.maxHp)} -> ${String(after.maxHp)}, HP ${String(before.currentHp)} -> ${String(after.currentHp)}/${String(after.maxHp)}`,
    );
    const rollLines = result.rolls.map(
      (r) =>
        `- ${r.label ?? r.expression}: ${r.expression} = ${String(r.total)}`,
    );
    const text = [
      ...lines,
      ...(rollLines.length > 0 ? ["", "Rolls:", ...rollLines] : []),
    ].join("\n");
    return ok(text, {
      instances: result.instances.map((c) => instanceView(c.after)),
      before: result.instances.map((c) => instanceView(c.before)),
      rolls: result.rolls,
    });
  },
});

const setArmorClassTool = defineTool({
  name: "set_armor_class",
  annotations: { destructiveHint: true },
  description:
    "Set a monster's armor class to an exact value (at least 0). Target is an instance id or exact name.",
  inputSchema: { target: z.string(), armorClass: z.number().int() },
  run(ctx, { target, armorClass }) {
    const [instance] = resolveTargets(ctx.repo.listInstances(), [target]);
    // Defensive: resolveTargets throws for an unknown target.
    if (!instance) return fail(`Unknown target "${target}"`);
    const before = instance.armorClass;
    const updated = ctx.repo.setArmorClass(
      instance.id,
      armorClass,
      mcpOrigin(ctx),
    );
    return ok(
      `${updated.displayName}: AC ${String(before ?? "unset")} -> ${String(updated.armorClass)}`,
      {
        instance: instanceView(updated),
        armorClass: updated.armorClass,
        before,
      },
    );
  },
});

const removeMonstersTool = defineTool({
  name: "remove_monsters",
  annotations: { destructiveHint: true },
  description:
    "Remove monsters by instance id or exact name. All targets must resolve, otherwise nothing is removed.",
  inputSchema: { targets: z.array(z.string()).min(1) },
  run(ctx, { targets }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was removed.`);
      }
      throw e;
    }
    const removed = ctx.repo.removeInstances(
      resolved.map((i) => i.id),
      mcpOrigin(ctx),
    );
    const names = removed.map((i) => i.displayName);
    return ok(`Removed ${String(names.length)}: ${names.join(", ")}`, {
      removed: removed.map(instanceView),
    });
  },
});

/** The reply of a restore: "Restored N: name (HP, was old name), ...". */
function restoredReply(restored: readonly RestoredMonster[]): ToolResult {
  const parts = restored.map(({ instance, renamedFrom }) => {
    const hp = `${String(instance.currentHp)}/${String(instance.maxHp)} HP`;
    const was = renamedFrom === null ? "" : `, was ${renamedFrom}`;
    return `${instance.displayName} (${hp}${was})`;
  });
  return ok(`Restored ${String(restored.length)}: ${parts.join(", ")}`, {
    restored: restored.map(({ instance, renamedFrom }) => ({
      ...instanceView(instance),
      renamedFrom,
    })),
  });
}

const restoreMonstersTool = defineTool({
  name: "restore_monsters",
  annotations: { destructiveHint: false },
  description:
    "Bring back monsters removed from the encounter, by instance id or exact name, with the HP, initiative and group they had. All targets must resolve, otherwise nothing is restored. list_encounter names what can be restored; a name taken meanwhile gets a new number.",
  inputSchema: { targets: z.array(z.string()).min(1) },
  run(ctx, { targets }) {
    let restored: RestoredMonster[];
    try {
      restored = restoreMonsters(
        { repo: ctx.repo, monsters: ctx.monsters },
        targets,
        mcpOrigin(ctx),
      );
    } catch (e) {
      if (e instanceof DomainError) {
        return fail(`${e.message}. Nothing was restored.`);
      }
      throw e;
    }
    return restoredReply(restored);
  },
});

const renameMonsterTool = defineTool({
  name: "rename_monster",
  annotations: { destructiveHint: true },
  description:
    "Rename a monster. Target is an instance id or exact name; the new name must be non-empty and not used by another monster.",
  inputSchema: { target: z.string(), name: z.string() },
  run(ctx, { target, name }) {
    const [instance] = resolveTargets(ctx.repo.listInstances(), [target]);
    // Defensive: resolveTargets throws for an unknown target.
    if (!instance) return fail(`Unknown target "${target}"`);
    const updated = ctx.repo.renameInstance(instance.id, name, mcpOrigin(ctx));
    return ok(`${instance.displayName} renamed to ${updated.displayName}`, {
      instance: instanceView(updated),
    });
  },
});

const changeMonsterTypeTool = defineTool({
  name: "change_monster_type",
  annotations: { destructiveHint: true },
  description:
    "Change monsters to another monster type, keeping their tokens' places. Targets are instance ids or exact names; monster is a monster key. Each gets a new numbered name and the new monster's max HP (hp: rolled by default, or average), AC and size; damage taken, the initiative roll (with the new modifier), group and stats visibility are kept. All targets must resolve, otherwise nothing changes.",
  inputSchema: {
    targets: z.array(z.string()).min(1),
    monster: z.string(),
    hp: z.enum(["rolled", "average"]).optional(),
  },
  run(ctx, { targets, monster, hp }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was changed.`);
      }
      throw e;
    }
    const result = changeMonsterType(
      { repo: ctx.repo, monsters: ctx.monsters, rng: ctx.rng, now: ctx.now },
      resolved.map((i) => i.id),
      monster,
      hp ?? "rolled",
      mcpOrigin(ctx),
    );
    const orNone = (value: number | null): string =>
      value === null ? "none" : String(value);
    const lines = result.instances.map(({ before, after, noLongerFits }) => {
      const line = `${before.displayName} -> ${after.displayName}: HP ${String(before.currentHp)}/${String(before.maxHp)} -> ${String(after.currentHp)}/${String(after.maxHp)}, AC ${orNone(before.armorClass)} -> ${orNone(after.armorClass)}, initiative ${orNone(before.initiative)} -> ${orNone(after.initiative)}`;
      return noLongerFits
        ? `${line}; no longer fits its cell (now ${String(after.footprint)}x${String(after.footprint)} cells)`
        : line;
    });
    const rollLines = result.rolls.map(
      (r) =>
        `- ${r.label ?? r.expression}: ${r.expression} = ${String(r.total)}`,
    );
    const text = [
      ...lines,
      ...(rollLines.length > 0 ? ["", "Rolls:", ...rollLines] : []),
    ].join("\n");
    return ok(text, {
      instances: result.instances.map((c) => instanceView(c.after)),
      before: result.instances.map((c) => instanceView(c.before)),
      noLongerFits: result.instances
        .filter((c) => c.noLongerFits)
        .map((c) => c.after.id),
      rolls: result.rolls,
    });
  },
});

const setInitiativeTool = defineTool({
  name: "set_initiative",
  annotations: { destructiveHint: true },
  description:
    "Set a monster's initiative to an exact value. Target is an instance id or exact name.",
  inputSchema: { target: z.string(), initiative: z.number().int() },
  run(ctx, { target, initiative }) {
    const [instance] = resolveTargets(ctx.repo.listInstances(), [target]);
    // Defensive: resolveTargets throws for an unknown target.
    if (!instance) return fail(`Unknown target "${target}"`);
    const before = instance.initiative;
    const updated = ctx.repo.setInitiative(
      instance.id,
      initiative,
      mcpOrigin(ctx),
    );
    return ok(
      `${updated.displayName}: initiative ${String(before ?? "unset")} -> ${String(updated.initiative)}`,
      { instance: instanceView(updated), before },
    );
  },
});

const rollInitiativeTool = defineTool({
  name: "roll_initiative",
  annotations: { destructiveHint: true },
  description:
    "Roll initiative (1d20 plus the monster's initiative modifier) for monsters already in the encounter, replacing any value they have. Targets are instance ids or exact names. mode group (default): named monsters of one group share one roll; each: one roll per monster. All targets must resolve, otherwise nothing changes.",
  inputSchema: {
    targets: z.array(z.string()).min(1),
    mode: z.enum(["group", "each"]).optional(),
  },
  run(ctx, { targets, mode }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was changed.`);
      }
      throw e;
    }
    const result = rollInitiative(
      { repo: ctx.repo, monsters: ctx.monsters, rng: ctx.rng, now: ctx.now },
      resolved.map((i) => i.id),
      mcpOrigin(ctx),
      mode,
    );
    const text = result.instances
      .map(
        (r) =>
          `${r.instance.displayName}: initiative ${String(r.before ?? "unset")} -> ${String(r.instance.initiative)} (d20 ${String(r.roll)}, modifier ${signed(r.modifier)})`,
      )
      .join("\n");
    return ok(text, {
      instances: result.instances.map((r) => ({
        ...instanceView(r.instance),
        before: r.before,
        roll: r.roll,
        modifier: r.modifier,
      })),
      rolls: result.rolls,
    });
  },
});

const splitInitiativeTool = defineTool({
  name: "split_initiative",
  annotations: { destructiveHint: true },
  description:
    "Give each named monster its own initiative group, so it acts on its own. Targets are instance ids or exact names. Each keeps its initiative unless roll is true, then each rolls its own. All targets must resolve, otherwise nothing changes.",
  inputSchema: {
    targets: z.array(z.string()).min(1),
    roll: z.boolean().optional(),
  },
  run(ctx, { targets, roll }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was changed.`);
      }
      throw e;
    }
    const result = splitInitiative(
      {
        repo: ctx.repo,
        monsters: ctx.monsters,
        rng: ctx.rng,
        now: ctx.now,
        newGroupId: ctx.newGroupId,
      },
      resolved.map((i) => i.id),
      mcpOrigin(ctx),
      { roll: roll === true },
    );
    const text = result.instances
      .map((r) => {
        const after = String(r.instance.initiative ?? "unset");
        if (r.rolled === undefined) {
          return `${r.instance.displayName}: own initiative group, initiative ${after}`;
        }
        const before = String(r.before ?? "unset");
        return `${r.instance.displayName}: own initiative group, initiative ${before} -> ${after} (d20 ${String(r.rolled.roll)}, modifier ${signed(r.rolled.modifier)})`;
      })
      .join("\n");
    return ok(text, {
      instances: result.instances.map((r) => ({
        ...instanceView(r.instance),
        before: r.before,
        ...(r.rolled === undefined
          ? {}
          : { roll: r.rolled.roll, modifier: r.rolled.modifier }),
      })),
      rolls: result.rolls,
    });
  },
});

const mergeInitiativeTool = defineTool({
  name: "merge_initiative",
  annotations: { destructiveHint: true },
  description:
    "Put the named monsters into one initiative group, so they act together. Targets are instance ids or exact names; each takes the initiative of the first named monster that has one, without a roll. All targets must resolve, otherwise nothing changes.",
  inputSchema: { targets: z.array(z.string()).min(1) },
  run(ctx, { targets }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was changed.`);
      }
      throw e;
    }
    const result = mergeInitiative(
      { repo: ctx.repo, newGroupId: ctx.newGroupId },
      resolved.map((i) => i.id),
      mcpOrigin(ctx),
    );
    const names = result.instances.map((r) => r.instance.displayName);
    const shared = String(result.initiative ?? "unset");
    const lines = [
      `One initiative group: ${names.join(", ")}; shared initiative ${shared}.`,
      ...result.instances.map(
        (r) =>
          `${r.instance.displayName}: initiative ${String(r.before ?? "unset")} -> ${String(r.instance.initiative ?? "unset")}`,
      ),
    ];
    return ok(lines.join("\n"), {
      instances: result.instances.map((r) => ({
        ...instanceView(r.instance),
        before: r.before,
      })),
      initiative: result.initiative,
    });
  },
});

const setStatsVisibilityTool = defineTool({
  name: "set_stats_visibility",
  annotations: { destructiveHint: false },
  description:
    "Reveal monsters' stats to players (visible: true) or hide them again (visible: false). Targets are instance ids or exact names. All targets must resolve, otherwise nothing changes.",
  inputSchema: { targets: z.array(z.string()).min(1), visible: z.boolean() },
  run(ctx, { targets, visible }) {
    let resolved: MonsterInstance[];
    try {
      resolved = resolveTargets(ctx.repo.listInstances(), targets);
    } catch (e) {
      if (e instanceof TargetError) {
        return fail(`${e.message}. Nothing was changed.`);
      }
      throw e;
    }
    const origin = mcpOrigin(ctx);
    const updated = resolved.map((i) =>
      ctx.repo.setStatsVisible(i.id, visible, origin),
    );
    const names = updated.map((i) => i.displayName).join(", ");
    return ok(
      `${visible ? "Revealed stats to players" : "Hid stats from players"}: ${names}`,
      { instances: updated.map(instanceView) },
    );
  },
});

const clearEncounterTool = defineTool({
  name: "clear_encounter",
  annotations: { destructiveHint: true },
  description:
    "Remove every monster from the encounter. The cleared monsters can be brought back with restore_encounter.",
  inputSchema: {},
  run(ctx) {
    const cleared = ctx.repo.clearEncounter(mcpOrigin(ctx));
    if (cleared.length === 0) {
      return ok("The encounter is already empty; nothing was cleared.", {
        removed: 0,
        cleared: [],
      });
    }
    const count = cleared.length;
    const names = cleared.map((i) => i.displayName).join(", ");
    const pronoun = count === 1 ? "It" : "They";
    return ok(
      `Cleared ${String(count)} ${count === 1 ? "monster" : "monsters"}: ${names}. ${pronoun} can be restored with restore_encounter.`,
      { removed: count, cleared: cleared.map(instanceView) },
    );
  },
});

const restoreEncounterTool = defineTool({
  name: "restore_encounter",
  annotations: { destructiveHint: false },
  description:
    "Bring back every monster the last clear_encounter removed, with the HP, initiative, group and stats visibility they had; their tokens are created again. Monsters added since stay; a name taken meanwhile gets a new number. Fails when nothing cleared is left to restore.",
  inputSchema: {},
  run(ctx) {
    return restoredReply(
      restoreEncounter(
        { repo: ctx.repo, monsters: ctx.monsters },
        mcpOrigin(ctx),
      ),
    );
  },
});

const undoTool = defineTool({
  name: "undo",
  annotations: { destructiveHint: true },
  description:
    "Undo the agent's last encounter change; say it again to go one change further back. Does not undo clear_encounter (use restore_encounter) or map and room changes.",
  inputSchema: {},
  run(ctx) {
    void ctx;
    throw new Error("not implemented");
  },
});

const tableStatusTool = defineTool({
  name: "table_status",
  annotations: { readOnlyHint: true },
  description:
    "Ask the connected Owlbear GM tab for its scene status (scene ready, our token count, applied instance count) and compare it with the encounter. Needs the bridge running.",
  inputSchema: {},
  async run(ctx) {
    const {
      sceneReady,
      tokenCount,
      appliedInstanceCount,
      encounterCount,
      inSync,
    } = await getTableStatus(ctx.repo, ctx.table);
    const counts = `${String(tokenCount)} tokens on the scene, ${String(appliedInstanceCount)} instances applied, ${String(encounterCount)} in the encounter`;
    const text = inSync
      ? `Owlbear is in sync: scene ready, ${counts}.`
      : `Owlbear is out of sync: ${sceneReady ? "scene ready" : "scene not ready"}, ${counts}.`;
    return ok(text, {
      sceneReady,
      tokenCount,
      appliedInstanceCount,
      encounterCount,
      inSync,
    });
  },
});

const useMapTool = defineTool({
  name: "use_map",
  annotations: { destructiveHint: false },
  description:
    "Use the map the GM aligned on the Owlbear scene: reads the scene's maps, picks one by name when there are several, records how it sits on the grid and makes it the active map. Needs the bridge running.",
  inputSchema: { name: z.string().min(1).optional() },
  async run(ctx, { name }) {
    const { map, cols, rows } = await useMap(ctx.table, ctx.maps, name);
    return ok(
      `Using ${map.name}: ${String(cols)} x ${String(rows)} cells, columns A-${formatColumnLabel(cols - 1)} left to right, rows 1-${String(rows)} top to bottom.`,
      { itemId: map.itemId, name: map.name, cols, rows },
    );
  },
});

const setRoomsTool = defineTool({
  name: "set_rooms",
  annotations: { destructiveHint: true },
  description:
    "Name rooms on the map in use by display-cell ranges such as T5:AB11; a room with several ranges (an L shape) lists each. A room named like a saved one (ignoring case) replaces it. Status is confirmed unless given as proposed. Reads where the map sits now; needs the bridge running.",
  inputSchema: {
    rooms: z
      .array(
        z.object({
          name: z.string().min(1),
          ranges: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
    status: z.enum(["confirmed", "proposed"]).optional(),
  },
  async run(ctx, { rooms, status }) {
    const result = await setRooms(ctx.table, ctx.maps, rooms, status);
    const saved = result.rooms
      .map((room) => `${room.name} ${room.ranges.join(", ")}`)
      .join("; ");
    const text = `Saved ${roomCount(result.rooms.length)} on ${result.map.name} (${result.rooms[0]?.status ?? ""}): ${saved}.`;
    return ok(withMovedLine(text, result.moved), { ...result });
  },
});

const listRoomsTool = defineTool({
  name: "list_rooms",
  annotations: { readOnlyHint: true },
  description:
    "List the rooms saved for the map in use, with their status and display-cell ranges where the map sits now. Needs the bridge running.",
  inputSchema: {},
  async run(ctx) {
    const result = await listRooms(ctx.table, ctx.maps);
    const text =
      result.rooms.length === 0
        ? `No rooms saved for ${result.map.name} yet.`
        : `Rooms on ${result.map.name}:\n\n${table(
            ["Room", "Status", "Cells"],
            result.rooms.map((room) => [
              room.name,
              room.status,
              room.ranges.length === 0 ? null : room.ranges.join(", "),
            ]),
          )}`;
    return ok(withMovedLine(text, result.moved), { ...result });
  },
});

const removeRoomsTool = defineTool({
  name: "remove_rooms",
  annotations: { destructiveHint: true },
  description:
    "Remove saved rooms from the map in use by name, ignoring case. Every name must match a saved room, or nothing is removed.",
  inputSchema: { names: z.array(z.string().min(1)).min(1) },
  run(ctx, { names }) {
    const result = removeRooms(ctx.maps, names);
    return ok(
      `Removed ${roomCount(result.removed.length)} from ${result.map.name}: ${result.removed.join(", ")}.`,
      { ...result },
    );
  },
});

const getMapImageTool = defineTool({
  name: "get_map_image",
  annotations: { readOnlyHint: true },
  description:
    "Get an image of the map in use as the DM sees it, with the column letters and row numbers of its display cells drawn on its edges, plus its grid size. Read room interiors from it to propose rooms. Needs the bridge running.",
  inputSchema: {},
  async run(ctx) {
    const { map, cols, rows, moved, image } = await getMapImage(
      ctx.table,
      ctx.maps,
    );
    const text = withMovedLine(
      `${map.name}: ${String(cols)} x ${String(rows)} cells, columns A-${formatColumnLabel(cols - 1)} left to right, rows 1-${String(rows)} top to bottom, labelled on the image's edges.`,
      moved,
    );
    return {
      content: [
        { type: "image", data: image.data, mimeType: image.mimeType },
        { type: "text", text },
      ],
      structuredContent: {
        itemId: map.itemId,
        name: map.name,
        cols,
        rows,
        moved,
        width: image.width,
        height: image.height,
      },
    };
  },
});

const proposeRoomsTool = defineTool({
  name: "propose_rooms",
  annotations: { readOnlyHint: true },
  description:
    "Turn room interiors read on the map image (display-cell ranges such as T5:AB11) into proposals: each range is shrunk by one cell on every side where the room is at least three cells wide. Saves nothing; save the proposals with set_rooms.",
  inputSchema: {
    rooms: z
      .array(
        z.object({
          name: z.string().min(1),
          ranges: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
  },
  run(_ctx, { rooms }) {
    const proposals = proposeRooms(rooms);
    const text = `Proposed ${roomCount(proposals.length)} (not saved): ${proposals
      .map((r) => `${r.name} ${r.ranges.join(", ")}`)
      .join("; ")}.`;
    return ok(text, { rooms: proposals });
  },
});

/** "1 room" or "2 rooms". */
function roomCount(n: number): string {
  return `${String(n)} ${n === 1 ? "room" : "rooms"}`;
}

const movedLine =
  "The map moved since it was registered; cells are read where it is now. Use the map again to confirm the new position.";

/** Splits placements into runs of consecutive ones of the same group. */
function runsByGroup<P>(
  placements: readonly P[],
  groupOf: (placement: P) => unknown,
): P[][] {
  const runs: P[][] = [];
  let previous: unknown;
  for (const placement of placements) {
    const group = groupOf(placement);
    const last = runs.at(-1);
    if (last === undefined || group !== previous) runs.push([placement]);
    else last.push(placement);
    previous = group;
  }
  return runs;
}

/**
 * One "Placed in" line and one "No free cell left" line per group with a
 * room, in group order; a group's placements are consecutive.
 */
function placementLines(
  placements: readonly RoomPlacement[],
  instances: readonly { id: string; groupId: string }[],
): string[] {
  const groupOf = new Map(instances.map((i) => [i.id, i.groupId] as const));
  return runsByGroup(placements, (p) => groupOf.get(p.id)).flatMap((run) => {
    const room = run[0]?.room ?? "";
    const placed = run.filter((p) => p.cell !== null);
    const unplaced = run.filter((p) => p.cell === null);
    const lines: string[] = [];
    if (placed.length > 0) {
      lines.push(
        `Placed in ${room}: ${placed.map((p) => `${p.name} at ${String(p.cell)}`).join(", ")}.`,
      );
    }
    if (unplaced.length > 0) {
      const names = unplaced.map((p) => p.name).join(", ");
      lines.push(
        unplaced.length === 1
          ? `No free cell left in ${room} for ${names}: its token appears in a row at the centre of the GM's view.`
          : `No free cell left in ${room} for ${names}: their tokens appear in a row at the centre of the GM's view.`,
      );
    }
    return lines;
  });
}

/**
 * One "Would be placed in" line and one "No free cell left" line per group
 * with a room, in group order; a group's placements are consecutive.
 */
function previewPlacementLines(
  placements: readonly PreviewPlacement[],
  instances: readonly PreviewInstance[],
): string[] {
  const groupOf = new Map(instances.map((i) => [i.name, i.group] as const));
  return runsByGroup(placements, (p) => groupOf.get(p.name)).flatMap((run) => {
    const room = run[0]?.room ?? "";
    const placed = run.filter((p) => p.cell !== null);
    const unplaced = run.filter((p) => p.cell === null);
    const lines: string[] = [];
    if (placed.length > 0) {
      lines.push(
        `Would be placed in ${room}: ${placed.map((p) => `${p.name} at ${String(p.cell)}`).join(", ")}.`,
      );
    }
    if (unplaced.length > 0) {
      lines.push(
        `No free cell left in ${room} for ${unplaced.map((p) => p.name).join(", ")}.`,
      );
    }
    return lines;
  });
}

/**
 * The "Moved into" line for the placed monsters and the "No free cell left"
 * line for the rest, each only when it names someone.
 */
function moveLines(placements: readonly RoomPlacement[]): string[] {
  const room = placements[0]?.room ?? "";
  const placed = placements.filter((p) => p.cell !== null);
  const unplaced = placements.filter((p) => p.cell === null);
  const lines: string[] = [];
  if (placed.length > 0) {
    lines.push(
      `Moved into ${room}: ${placed.map((p) => `${p.name} at ${String(p.cell)}`).join(", ")}.`,
    );
  }
  if (unplaced.length > 0) {
    const names = unplaced.map((p) => p.name).join(", ");
    lines.push(
      unplaced.length === 1
        ? `No free cell left in ${room} for ${names}: it stays where it is.`
        : `No free cell left in ${room} for ${names}: they stay where they are.`,
    );
  }
  return lines;
}

function withMovedLine(text: string, moved: boolean): string {
  return moved ? `${text}\n\n${movedLine}` : text;
}

/** The list_encounter line for the last clear's monsters: named up to five, else counted. */
function clearedListLine(cleared: readonly MonsterInstance[]): string[] {
  if (cleared.length === 0) return [];
  if (cleared.length > 5) {
    return [
      `Cleared encounter: ${String(cleared.length)} monsters, can be restored with restore_encounter.`,
    ];
  }
  const names = cleared.map((i) => i.displayName).join(", ");
  return [
    `Cleared encounter, can be restored with restore_encounter: ${names}.`,
  ];
}

export const tools: readonly ToolDefinition[] = [
  searchMonstersTool,
  getStatblockTool,
  addMonstersTool,
  previewMonstersTool,
  moveMonstersTool,
  listEncounterTool,
  hpTool("damage"),
  hpTool("heal"),
  setHpTool,
  setMaxHpTool,
  resetMaxHpTool,
  setArmorClassTool,
  removeMonstersTool,
  restoreMonstersTool,
  renameMonsterTool,
  changeMonsterTypeTool,
  setInitiativeTool,
  rollInitiativeTool,
  splitInitiativeTool,
  mergeInitiativeTool,
  setStatsVisibilityTool,
  clearEncounterTool,
  restoreEncounterTool,
  undoTool,
  tableStatusTool,
  useMapTool,
  setRoomsTool,
  listRoomsTool,
  removeRoomsTool,
  getMapImageTool,
  proposeRoomsTool,
];
