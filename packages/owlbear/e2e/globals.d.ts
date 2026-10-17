import type { FakeHost } from "./fake-host.js";
import type { ObrAdapter } from "../src/obr-adapter.js";
import type { SceneItem } from "../src/scene-model.js";

declare global {
  interface Window {
    __host?: FakeHost;
    __e2e?: {
      /** The real adapter, for direct getItems/updateItems/deleteItems. */
      obr: ObrAdapter;
      addHiddenToken(token: {
        id: string;
        name: string;
        position: { x: number; y: number };
      }): Promise<SceneItem>;
      writeInitiativeMetadata(value: unknown): Promise<void>;
      /** Send a raw SDK-shaped message; resolves with the host's reply. */
      sendRaw(id: string): Promise<{ id: string; data: unknown }>;
    };
  }
}
