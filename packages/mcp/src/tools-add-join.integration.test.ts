import type { Rng } from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  SqliteMapRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const SHADOW = "srd-2024_shadow";
const monsters = loadSrdMonsters();

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max. */
function cycleRng(...values: number[]): Rng {
  let i = 0;
  return {
    nextInt(max) {
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
}

let ctx: ToolContext;
let groupN: number;

beforeEach(() => {
  groupN = 0;
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters,
    rng: cycleRng(0, 3, 5, 7),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${++groupN}`,
    newCommandId: () => "command",
  };
});

async function addMonsters(args: unknown): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === "add_monsters");
  if (!tool) throw new Error("no tool add_monsters");
  return tool.handler(ctx, args);
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function stored(name: string) {
  const found = ctx.repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

async function seedShadows(count: number): Promise<void> {
  const r = await addMonsters({ groups: [{ monster: SHADOW, count }] });
  expect(r.isError).toBeUndefined();
}

describe("add_monsters with join", () => {
  it("add_monsters with join adds the monsters to the member's group at its initiative, with no initiative roll in the Rolls lines", async () => {
    await seedShadows(2);
    ctx.repo.setInitiative(stored("Shadow 1").id, 14, {
      source: "mcp",
      commandId: "seed",
    });

    const r = await addMonsters({
      groups: [{ monster: SHADOW, count: 2, join: "Shadow 1" }],
    });
    expect(r.isError).toBeUndefined();
    const added = r.structuredContent?.["instances"] as {
      name: string;
      groupId: string;
      initiative: number | null;
    }[];
    expect(added.map((i) => [i.name, i.groupId, i.initiative])).toEqual([
      ["Shadow 3", "group-1", 14],
      ["Shadow 4", "group-1", 14],
    ]);
    expect(
      ["Shadow 3", "Shadow 4"].map((n) => [
        stored(n).groupId,
        stored(n).initiative,
      ]),
    ).toEqual([
      ["group-1", 14],
      ["group-1", 14],
    ]);
    const reply = text(r);
    expect(reply).toMatch(/\| Shadow 3 \| [^\n]* \| 14 \|/);
    const rollsSection = reply.slice(reply.indexOf("Rolls:"));
    expect(rollsSection).toContain("Shadow 3 HP");
    expect(rollsSection).toContain("Shadow 4 HP");
    expect(rollsSection).not.toContain("initiative");
  });

  it("add_monsters whose only group joins with average HP replies without a Rolls section", async () => {
    await seedShadows(1);
    const member = stored("Shadow 1");

    const r = await addMonsters({
      groups: [{ monster: SHADOW, count: 1, hp: "average", join: "Shadow 1" }],
    });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.["rolls"]).toEqual([]);
    expect(stored("Shadow 2").groupId).toBe(member.groupId);
    const reply = text(r);
    expect(reply).toContain("| Shadow 2 |");
    expect(reply).not.toContain("Rolls:");
  });

  it("add_monsters with an unknown join fails with the unknown-group message and stores nothing", async () => {
    await seedShadows(1);
    const before = ctx.repo.listInstances();

    const r = await addMonsters({
      groups: [{ monster: SHADOW, count: 1, join: "Shadow 9" }],
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(
      `Group 1 (${SHADOW}): no monster "Shadow 9" in the encounter to join`,
    );
    expect(ctx.repo.listInstances()).toEqual(before);
  });
});
