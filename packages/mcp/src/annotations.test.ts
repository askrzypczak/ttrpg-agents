import { describe, expect, it } from "vitest";
import { tools, type ToolAnnotations } from "./tools.js";

const expected: Record<string, ToolAnnotations | undefined> = {
  search_monsters: { readOnlyHint: true },
  get_statblock: { readOnlyHint: true },
  list_encounter: { readOnlyHint: true },
  add_monsters: { destructiveHint: false },
  remove_monsters: { destructiveHint: true },
  rename_monster: { destructiveHint: true },
  set_initiative: { destructiveHint: true },
  set_hp: { destructiveHint: true },
  set_max_hp: { destructiveHint: true },
  set_armor_class: { destructiveHint: true },
  set_stats_visibility: { destructiveHint: false },
  clear_encounter: { destructiveHint: true },
  apply_damage: undefined,
  heal: undefined,
  table_status: { readOnlyHint: true },
  use_map: { destructiveHint: false },
  set_rooms: { destructiveHint: true },
  list_rooms: { readOnlyHint: true },
  remove_rooms: { destructiveHint: true },
  get_map_image: { readOnlyHint: true },
  propose_rooms: { readOnlyHint: true },
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
