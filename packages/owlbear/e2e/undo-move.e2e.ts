import { undoLastCommand, type ChangeOrigin } from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import type { SceneItem, Vec2 } from "../src/scene-model.js";
import { SHADOW_IDS } from "./db.js";
import { test, expect, openHarness } from "./fixtures.js";
import { readItems } from "./helpers.js";

const moveOrigin: ChangeOrigin = {
  source: "mcp",
  commandId: "move",
  command: "move_monsters",
};
const undoOrigin: ChangeOrigin = {
  source: "mcp",
  commandId: "undo",
  command: "undo",
};

const INSTANCE_KEY = "com.ttrpg-agents/instance";

/** Where the GM drags Shadow 1's token, off the default row. */
const dragged: Vec2 = { x: 2400, y: 1800 };
/** The spawn position the move sets, away from the row and the drag. */
const moved: Vec2 = { x: 3300, y: 2700 };

/** Our token for the instance with this id. */
function tokenOf(items: SceneItem[], instanceId: string): SceneItem {
  const found = items.find(
    (i) =>
      (i.metadata[INSTANCE_KEY] as { instanceId?: string } | undefined)
        ?.instanceId === instanceId,
  );
  if (!found) throw new Error(`no token for ${instanceId}`);
  return found;
}

/** Runs `use` with a repository on the bridge's database, closing it after. */
function withRepo<T>(
  dbPath: string,
  use: (repo: SqliteEncounterRepository) => T,
): T {
  const db = openDatabase(dbPath);
  try {
    return use(new SqliteEncounterRepository(db));
  } finally {
    db.close();
  }
}

test.describe("undoing a move", () => {
  test("a token moved out of the default row goes back to where it stood when the move is undone", async ({
    page,
    bridge,
  }) => {
    const id = SHADOW_IDS[0]!;
    const position = async () => tokenOf(await readItems(page), id).position;
    await openHarness(page, { role: "gm" });
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    // The GM drags Shadow 1's token out of the row.
    const token = tokenOf(await readItems(page), id);
    await page.evaluate(
      ({ itemId, to }) =>
        window.__host!.scene.updateItems([itemId], { position: to }),
      { itemId: token.id, to: dragged },
    );
    await expect.poll(position).toEqual(dragged);

    withRepo(bridge.dbPath, (repo) =>
      repo.setSpawnPositions([{ id, spawnPosition: moved }], moveOrigin),
    );
    await expect.poll(position).toEqual(moved);

    withRepo(bridge.dbPath, (repo) => undoLastCommand(repo, undoOrigin));

    await expect.poll(position).toEqual(dragged);
    const stored = withRepo(bridge.dbPath, (repo) =>
      repo.listInstances().find((i) => i.id === id),
    );
    expect(stored?.spawnPosition).toBeNull();
    await expect(
      page.frameLocator("#extension").locator("#sync-error"),
    ).toHaveText("");
  });
});
