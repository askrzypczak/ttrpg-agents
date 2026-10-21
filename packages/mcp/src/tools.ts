import {
  DomainError,
  TargetError,
  addMonsters,
  compareByInitiative,
  resolveTargets,
  getMonsterByKey,
  searchMonsters,
  type MonsterInstance,
} from "@ttrpg-agents/engine";
import { z } from "zod";
import type { ToolContext } from "./context.js";
import { formatStatblock } from "./statblock.js";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
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

const addMonstersTool = defineTool({
  name: "add_monsters",
  annotations: { destructiveHint: false },
  description:
    "Add groups of monsters to the encounter in one call. Rolls HP (or uses average) and initiative, and numbers names automatically.",
  inputSchema: {
    groups: z.array(
      z.object({
        monster: z.string().describe("Monster key, e.g. srd-2024_shadow"),
        count: z.number().int().min(1),
        hp: z.enum(["rolled", "average"]).optional(),
      }),
    ),
    initiative: z
      .enum(["group", "each"])
      .optional()
      .describe("One roll per group (default) or per monster"),
  },
  run(ctx, { groups, initiative }) {
    const result = addMonsters(
      {
        repo: ctx.repo,
        monsters: ctx.monsters,
        rng: ctx.rng,
        now: ctx.now,
        newGroupId: ctx.newGroupId,
      },
      groups,
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
      "",
      "Rolls:",
      ...result.rolls.map(
        (r) =>
          `- ${r.label ?? r.expression}: ${r.expression} = ${String(r.total)}`,
      ),
    ].join("\n");
    return ok(text, { instances: result.instances, rolls: result.rolls });
  },
});

const listEncounterTool = defineTool({
  name: "list_encounter",
  annotations: { readOnlyHint: true },
  description: "List the encounter in initiative order (highest first).",
  inputSchema: {},
  run(ctx) {
    const instances = ctx.repo.listInstances().sort(compareByInitiative);
    if (instances.length === 0) {
      return ok("The encounter is empty.", { instances: [] });
    }
    return ok(
      table(
        ["id", "name", "HP", "initiative"],
        instances.map((i) => [
          i.id,
          i.displayName,
          `${String(i.currentHp)}/${String(i.maxHp)}`,
          i.initiative,
        ]),
      ),
      { instances: instances.map(instanceView) },
    );
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
      const { before, after } = damage
        ? ctx.repo.applyDamage(instance.id, amount)
        : ctx.repo.applyHealing(instance.id, amount);
      return ok(
        `${after.displayName}: ${String(before.currentHp)} -> ${String(after.currentHp)}/${String(after.maxHp)} HP`,
        { instance: instanceView(after) },
      );
    },
  });
}

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
    const removed = ctx.repo.removeInstances(resolved.map((i) => i.id));
    const names = removed.map((i) => i.displayName);
    return ok(`Removed ${String(names.length)}: ${names.join(", ")}`, {
      removed: removed.map(instanceView),
    });
  },
});

const clearEncounterTool = defineTool({
  name: "clear_encounter",
  annotations: { destructiveHint: true },
  description: "Remove every monster from the encounter.",
  inputSchema: {},
  run(ctx) {
    const count = ctx.repo.listInstances().length;
    ctx.repo.clearEncounter();
    return ok(
      `Cleared ${String(count)} ${count === 1 ? "monster" : "monsters"}.`,
      { removed: count },
    );
  },
});

const tableStatusTool = defineTool({
  name: "table_status",
  annotations: { readOnlyHint: true },
  description:
    "Ask the connected Owlbear GM tab for its scene status (scene ready, our token count, applied instance count) and compare it with the encounter. Needs the bridge running.",
  inputSchema: {},
  run() {
    throw new Error("not implemented");
  },
});

export const tools: readonly ToolDefinition[] = [
  searchMonstersTool,
  getStatblockTool,
  addMonstersTool,
  listEncounterTool,
  hpTool("damage"),
  hpTool("heal"),
  removeMonstersTool,
  clearEncounterTool,
  tableStatusTool,
];
