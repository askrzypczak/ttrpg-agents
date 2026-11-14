import {
  PROTOCOL_VERSION,
  sceneIdSchema,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Metadata } from "./scene-model.js";

/** Scene metadata: the scene's id, minted once by the GM tab. */
export const SCENE_ID_METADATA_KEY = "com.ttrpg-agents/scene-id";

/** The scene id stored in this scene metadata, when it is a valid one. */
export function sceneIdOf(metadata: Metadata): string | undefined {
  const parsed = sceneIdSchema.safeParse(metadata[SCENE_ID_METADATA_KEY]);
  return parsed.success ? parsed.data : undefined;
}

/** Reports the open scene to the bridge with `scene-open`. */
export interface OpenSceneReporter {
  /** The id last read: null while no scene is ready, undefined before the first read. */
  current(): string | null | undefined;
  /** Sends the open scene again after the bridge acknowledged a connection. */
  helloAck(): Promise<void>;
}

/**
 * Reports the scene the GM has open: on start when a scene is ready, on each
 * ready change to true and on `helloAck()`, it reads the scene's id and sends
 * `scene-open` with it; on a ready change to false it sends null, and so does
 * a `helloAck()` while no scene is ready. A scene with no usable id (none, or
 * one `sceneIdSchema` refuses) first gets one minted into its metadata
 * (`options.mint`, default a random UUID); a usable id is never replaced, so
 * a duplicated scene keeps its original's id. Reads and mints run one at a
 * time, and a ready change discards the ones begun before it, so an id read
 * in one scene is never written into the next or sent after a newer one. A
 * send that does not go out is dropped: the next `helloAck()` sends the
 * latest. A read or write that fails sends nothing; the next ready change or
 * `helloAck()` reads again. `options.onChange` hears `current()` change.
 */
export function createOpenSceneReporter(
  obr: ObrAdapter,
  send: (message: BridgeMessage) => boolean,
  options: {
    mint?: () => string;
    onChange?: (sceneId: string | null) => void;
  } = {},
): OpenSceneReporter {
  const mint = options.mint ?? (() => crypto.randomUUID());
  let current: string | null | undefined;
  // Bumped by every ready change: work begun before it is for another scene.
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();

  function report(sceneId: string | null): void {
    if (sceneId !== current) {
      current = sceneId;
      try {
        options.onChange?.(sceneId);
      } catch {
        // A throwing handler must not stop the report.
      }
    }
    send({ v: PROTOCOL_VERSION, type: "scene-open", payload: { sceneId } });
  }

  /** Reads the ready scene's id, minting one when it has none, and reports it. */
  async function readAndReport(begun: number): Promise<void> {
    const metadata = await obr.getSceneMetadata();
    if (begun !== generation) return;
    let sceneId = sceneIdOf(metadata);
    if (sceneId === undefined) {
      const minted = mint();
      await obr.setSceneMetadata({ [SCENE_ID_METADATA_KEY]: minted });
      if (begun !== generation) return;
      sceneId = minted;
    }
    report(sceneId);
  }

  /** Runs after the reads and mints before it; never rejects. */
  function serialised(task: () => Promise<void>): Promise<void> {
    tail = tail.then(task).catch(() => {});
    return tail;
  }

  obr.onSceneReadyChange((ready) => {
    const begun = ++generation;
    if (!ready) {
      report(null);
      return;
    }
    void serialised(async () => {
      if (begun !== generation) return;
      await readAndReport(begun);
    });
  });

  // No ready change fires for a scene already open when the extension loads.
  const started = generation;
  void serialised(async () => {
    const ready = await obr.isSceneReady();
    if (!ready || started !== generation) return;
    await readAndReport(started);
  });

  return {
    current: () => current,
    helloAck() {
      const begun = generation;
      return serialised(async () => {
        if (begun !== generation) return;
        const ready = await obr.isSceneReady();
        if (begun !== generation) return;
        if (!ready) {
          report(null);
          return;
        }
        await readAndReport(begun);
      });
    },
  };
}
