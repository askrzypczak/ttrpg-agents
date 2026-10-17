import type { ObrAdapter } from "./obr-adapter.js";
import type { GridSpec, ImageSpec, SceneItem, Vec2 } from "./scene-model.js";

/** Worked example: add a token the players cannot see. */
export async function addHiddenToken(
  obr: ObrAdapter,
  token: {
    id: string;
    name: string;
    position: Vec2;
    image: ImageSpec;
    grid: GridSpec;
  },
): Promise<SceneItem> {
  const item: SceneItem = {
    id: token.id,
    type: "IMAGE",
    name: token.name,
    visible: false,
    position: token.position,
    metadata: {},
    image: token.image,
    grid: token.grid,
  };
  await obr.addItems([item]);
  return item;
}
