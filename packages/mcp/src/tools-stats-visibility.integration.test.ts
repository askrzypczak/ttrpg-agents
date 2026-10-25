import type { NewMonsterInstance, ChangeOrigin } from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

const SHADOW = "srd-2024_shadow";

let ctx: ToolContext;

beforeEach(() => {
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
    newCommandId: () => "command",
  };
});

async function setVisibility(
  targets: string[],
  visible: boolean,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === "set_stats_visibility");
  if (!tool) throw new Error("no tool set_stats_visibility");
  return tool.handler(ctx, { targets, visible });
}

function text(r: ToolResult): string {
  return r.content.map((c) => c.text).join("\n");
}

function seed(...items: NewMonsterInstance[]): void {
  ctx.repo.addInstances(() => items, origin);
}

function item(displayName: string, initiative: number): NewMonsterInstance {
  return { monsterKey: SHADOW, displayName, maxHp: 10, initiative };
}

const flags = () =>
  ctx.repo.listInstances().map((i) => [i.displayName, i.statsVisible]);

describe("set_stats_visibility failures", () => {
  it("an unknown target fails with the target error and says nothing was changed", async () => {
    seed(item("A", 1), item("B", 2));
    const r = await setVisibility(["A", "Ghost"], true);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Unknown target "Ghost"');
    expect(text(r)).toContain("Nothing was changed.");
    expect(flags()).toEqual([
      ["A", false],
      ["B", false],
    ]);
  });

  it("an ambiguous name fails with the target error and changes nothing", async () => {
    seed(item("A", 1), item("Twin", 2), item("Twin", 3));
    const r = await setVisibility(["A", "Twin"], true);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Ambiguous");
    expect(text(r)).toContain("Nothing was changed.");
    expect(flags()).toEqual([
      ["A", false],
      ["Twin", false],
      ["Twin", false],
    ]);
  });
});

describe("set_stats_visibility result", () => {
  it.each([true, false])(
    "lists each updated instance when visible is %s",
    async (visible) => {
      seed(
        { ...item("A", 1), statsVisible: !visible },
        { ...item("B", 2), statsVisible: !visible },
        { ...item("C", 3), statsVisible: !visible },
      );
      const [a, , c] = ctx.repo.listInstances();
      const r = await setVisibility(["A", c?.id ?? ""], visible);
      expect(r.isError).toBeUndefined();
      expect(text(r)).toBe(
        `${visible ? "Revealed stats to players" : "Hid stats from players"}: A, C`,
      );
      expect(r.structuredContent?.["instances"]).toEqual([
        {
          id: a?.id,
          name: "A",
          monsterKey: SHADOW,
          hp: 10,
          maxHp: 10,
          initiative: 1,
        },
        {
          id: c?.id,
          name: "C",
          monsterKey: SHADOW,
          hp: 10,
          maxHp: 10,
          initiative: 3,
        },
      ]);
    },
  );
});
