import { describe, expect, it } from "vitest";
import { tools, type ToolAnnotations } from "./tools.js";

const expected: Record<string, ToolAnnotations | undefined> = {
  search_monsters: { readOnlyHint: true },
  get_statblock: { readOnlyHint: true },
  list_encounter: { readOnlyHint: true },
  add_monsters: { destructiveHint: false },
  remove_monsters: { destructiveHint: true },
  clear_encounter: { destructiveHint: true },
  apply_damage: undefined,
  heal: undefined,
};

describe("tool annotations", () => {
  it("every tool in `tools` has exactly the expected annotations", () => {
    expect(Object.keys(expected).sort()).toEqual(
      tools.map((t) => t.name).sort(),
    );
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual(expected[tool.name]);
    }
  });
});
