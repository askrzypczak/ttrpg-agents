import type { BridgeMessage } from "@ttrpg-agents/protocol";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Metadata } from "./scene-model.js";

/** Scene metadata: the scene's id, minted once by the GM tab. */
export const SCENE_ID_METADATA_KEY = "com.ttrpg-agents/scene-id";

/** The scene id stored in this scene metadata, when it is a valid one. */
export function sceneIdOf(metadata: Metadata): string | undefined {
  void metadata;
  throw new Error("not implemented");
}

/** Reports the open scene to the bridge with `scene-open`. */
export interface OpenSceneReporter {
  /** The id last read: null while no scene is ready, undefined before the first read. */
  current(): string | null | undefined;
  /** Sends the open scene again after the bridge acknowledged a connection. */
  helloAck(): Promise<void>;
}

export function createOpenSceneReporter(
  obr: ObrAdapter,
  send: (message: BridgeMessage) => boolean,
  options?: {
    mint?: () => string;
    onChange?: (sceneId: string | null) => void;
  },
): OpenSceneReporter {
  void obr;
  void send;
  void options;
  throw new Error("not implemented");
}
