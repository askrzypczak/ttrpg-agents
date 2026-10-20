export type PlayerRole = "gm" | "player";

export type Metadata = Record<string, unknown>;

export type Vec2 = { x: number; y: number };

export type Layer =
  | "MAP"
  | "GRID"
  | "DRAWING"
  | "PROP"
  | "MOUNT"
  | "CHARACTER"
  | "ATTACHMENT"
  | "NOTE"
  | "TEXT"
  | "RULER"
  | "FOG"
  | "POINTER"
  | "POST_PROCESS"
  | "CONTROL"
  | "POPOVER";

/** Image content of an IMAGE item (what the SDK's buildImage needs). */
export interface ImageSpec {
  url: string;
  mime: string;
  width: number;
  height: number;
}

/** How an image maps onto the scene grid. */
export interface GridSpec {
  dpi: number;
  offset: Vec2;
}

/** Geometry of a SHAPE item (what the SDK's buildShape needs). */
export interface ShapeSpec {
  shapeType: "RECTANGLE" | "CIRCLE" | "TRIANGLE" | "HEXAGON";
  width: number;
  height: number;
}

export interface SceneItem {
  id: string;
  type: string;
  name: string;
  visible: boolean;
  position: Vec2;
  metadata: Metadata;
  /** Required by the real adapter when adding an IMAGE item. */
  image?: ImageSpec;
  /** Required by the real adapter when adding an IMAGE item. */
  grid?: GridSpec;
  /** Required by the real adapter when adding a SHAPE item. */
  shape?: ShapeSpec;
  /** Layer when adding. Default: "CHARACTER". */
  layer?: Layer;
  /** Scale when adding. Default: { x: 1, y: 1 }. */
  scale?: Vec2;
}

export type ItemPatch = Partial<
  Pick<SceneItem, "name" | "visible" | "position" | "metadata">
>;

export type SceneChange =
  { kind: "items" } | { kind: "metadata" } | { kind: "ready"; ready: boolean };

/** What the real SDK rejects item calls with while no scene is loaded. */
export class MissingSceneError extends Error {
  override name = "MissingDataError";
  constructor() {
    super("No scene found");
  }
}

/**
 * Pure in-memory model of the Owlbear scene (items, scene metadata, role,
 * ready flag). No SDK or test-framework imports, so the e2e fake host can
 * reuse it.
 */
export class SceneModel {
  private readonly items = new Map<string, SceneItem>();
  private metadata: Metadata = {};
  private readonly listeners = new Set<(change: SceneChange) => void>();

  constructor(
    public role: PlayerRole = "gm",
    private ready = true,
  ) {}

  onChange(listener: (change: SceneChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: SceneChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  isReady(): boolean {
    return this.ready;
  }

  setReady(ready: boolean): void {
    if (ready === this.ready) return;
    this.ready = ready;
    this.emit({ kind: "ready", ready });
  }

  addItems(items: SceneItem[]): void {
    for (const item of items) {
      if (this.items.has(item.id))
        throw new Error(`duplicate item id ${item.id}`);
      this.items.set(item.id, structuredClone(item));
    }
    this.emit({ kind: "items" });
  }

  getItems(filter?: (item: SceneItem) => boolean): SceneItem[] {
    const all = [...this.items.values()].map((i) => structuredClone(i));
    return filter ? all.filter(filter) : all;
  }

  updateItems(ids: string[], patch: ItemPatch): void {
    // Explicit-undefined keys mean "no change", like the real adapter.
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    let changed = false;
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) continue;
      this.items.set(id, structuredClone({ ...item, ...defined }));
      changed = true;
    }
    if (changed) this.emit({ kind: "items" });
  }

  deleteItems(ids: string[]): void {
    let changed = false;
    for (const id of ids) if (this.items.delete(id)) changed = true;
    if (changed) this.emit({ kind: "items" });
  }

  getMetadata(): Metadata {
    return structuredClone(this.metadata);
  }

  /** Shallow-merges into existing scene metadata, like the real SDK. */
  setMetadata(update: Metadata): void {
    this.metadata = { ...this.metadata, ...structuredClone(update) };
    this.emit({ kind: "metadata" });
  }
}
