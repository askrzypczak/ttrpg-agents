import {
  displayGrid,
  formatColumnLabel,
  mapTransform,
  scenePlacement,
  type MapPlacement,
  type SavedRoom,
  type TableMapItem,
} from "@ttrpg-agents/engine";
import type {
  SceneGrid,
  SceneItem,
  StrokeSpec,
  TextSpec,
  Vec2,
} from "./scene-model.js";

/** Item metadata key marking an overlay item; its value is `{ part }`. */
export const OVERLAY_METADATA_KEY = "com.ttrpg-agents/overlay";

/** What an overlay item draws. */
export type OverlayPart =
  | "column-label"
  | "column-tick"
  | "row-label"
  | "row-tick"
  | "room-outline"
  | "room-name";

const LABEL_COLOR = "#ffffff";
const OUTLINE_COLOR = "#000000";
const CONFIRMED_COLOR = "#3fb950";
const PROPOSED_COLOR = "#d29922";

/**
 * The placement of a map image on the scene grid, or undefined unless the
 * item is an IMAGE on the MAP layer with image and grid specs.
 */
export function mapPlacementOf(
  item: SceneItem,
  grid: SceneGrid,
): MapPlacement | undefined {
  const { image, grid: imageGrid } = item;
  if (item.type !== "IMAGE" || item.layer !== "MAP" || !image || !imageGrid)
    return undefined;
  const scale = item.scale ?? { x: 1, y: 1 };
  const tableItem: TableMapItem = {
    id: item.id,
    name: item.name,
    imageWidth: image.width,
    imageHeight: image.height,
    imageDpi: imageGrid.dpi,
    imageOffset: { x: imageGrid.offset.x, y: imageGrid.offset.y },
    position: { x: item.position.x, y: item.position.y },
    rotation: item.rotation ?? 0,
    scale: { x: scale.x, y: scale.y },
  };
  return scenePlacement(
    { grid: { dpi: grid.dpi, type: grid.type }, maps: [] },
    tableItem,
  );
}

/**
 * The overlay's items in scene coordinates: the display grid's column and
 * row labels and ticks, and each room's outlines and name.
 */
export function planOverlay(
  placement: MapPlacement,
  rooms: readonly SavedRoom[],
): SceneItem[] {
  const d = placement.sceneDpi;
  const grid = displayGrid(placement);
  const transform = mapTransform(placement);
  const left = grid.origin.col * d;
  const top = grid.origin.row * d;
  const tick = d / 4;
  const counts = new Map<OverlayPart, number>();

  const base = (part: OverlayPart, type: string, position: Vec2): SceneItem => {
    const n = counts.get(part) ?? 0;
    counts.set(part, n + 1);
    return {
      id: `ttrpg-overlay-${part}-${String(n)}`,
      type,
      name: "Map overlay",
      visible: true,
      position,
      metadata: { [OVERLAY_METADATA_KEY]: { part } },
      layer: "DRAWING",
      locked: true,
      disableHit: true,
    };
  };
  const text = (
    part: OverlayPart,
    box: { x: number; y: number; width: number; height: number },
    spec: Pick<TextSpec, "plainText" | "align" | "alignVertical"> & {
      fillColor?: string;
    },
  ): SceneItem => ({
    ...base(part, "TEXT", { x: box.x, y: box.y }),
    text: {
      plainText: spec.plainText,
      width: box.width,
      height: box.height,
      align: spec.align,
      alignVertical: spec.alignVertical,
      fontSize: d * 0.3,
      fillColor: spec.fillColor ?? LABEL_COLOR,
      strokeColor: OUTLINE_COLOR,
      strokeWidth: d / 75,
    },
  });
  const tickStroke: StrokeSpec = {
    color: LABEL_COLOR,
    width: d / 50,
    dash: [],
  };
  const line = (part: OverlayPart, start: Vec2, end: Vec2): SceneItem => ({
    ...base(part, "LINE", { x: 0, y: 0 }),
    line: { start, end, stroke: { ...tickStroke } },
  });

  const items: SceneItem[] = [];
  for (let c = 0; c < grid.cols; c++) {
    const x = left + (c + 0.5) * d;
    items.push(line("column-tick", { x, y: top }, { x, y: top - tick }));
    items.push(
      text(
        "column-label",
        { x: left + c * d, y: top - tick - d / 2, width: d, height: d / 2 },
        {
          plainText: formatColumnLabel(c),
          align: "CENTER",
          alignVertical: "MIDDLE",
        },
      ),
    );
  }
  for (let r = 0; r < grid.rows; r++) {
    const y = top + (r + 0.5) * d;
    items.push(line("row-tick", { x: left, y }, { x: left - tick, y }));
    items.push(
      text(
        "row-label",
        { x: left - tick - d, y: top + r * d, width: d, height: d },
        {
          plainText: String(r + 1),
          align: "RIGHT",
          alignVertical: "MIDDLE",
        },
      ),
    );
  }

  for (const room of rooms) {
    const proposed = room.status === "proposed";
    const stroke: StrokeSpec = proposed
      ? { color: PROPOSED_COLOR, width: d / 25, dash: [d / 6, d / 12] }
      : { color: CONFIRMED_COLOR, width: d / 25, dash: [] };
    const polygons = room.polygons.map((polygon) =>
      polygon.map((p) => transform.imageToScene(p)),
    );
    for (const points of polygons) {
      items.push({
        ...base("room-outline", "CURVE", { x: 0, y: 0 }),
        curve: { points, stroke: { ...stroke, dash: [...stroke.dash] } },
      });
    }
    const first = polygons[0];
    if (!first || first.length === 0) continue;
    const xs = first.map((p) => p.x);
    const ys = first.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    items.push(
      text(
        "room-name",
        {
          x: minX,
          y: minY,
          width: Math.max(...xs) - minX,
          height: Math.max(...ys) - minY,
        },
        {
          plainText: proposed ? `${room.name} (proposed)` : room.name,
          align: "CENTER",
          alignVertical: "MIDDLE",
          ...(proposed ? { fillColor: PROPOSED_COLOR } : {}),
        },
      ),
    );
  }
  return items;
}
