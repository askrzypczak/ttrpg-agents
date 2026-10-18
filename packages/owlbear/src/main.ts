import {
  PROTOCOL_VERSION,
  ReconnectingSocket,
  type SocketLike,
  type SocketState,
} from "@ttrpg-agents/core/bridge";
import { createEncounterSync } from "./encounter-sync.js";
import { createObrAdapter } from "./obr-adapter.js";
import { describeError, panelView } from "./panel-state.js";

const BRIDGE_URL = "ws://localhost:5199/ws";
const EXTENSION_VERSION = "0.0.0";

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found;
}

const obr = createObrAdapter();

obr.onReady(async () => {
  const role = await obr.getRole();

  // The bridge serves the manifest with the token as the popover URL fragment.
  const token = /^#([0-9a-f]{64})/.exec(location.hash)?.[1] ?? "";
  const tokenMissing = token === "";

  let socketState: SocketState = "connecting";
  let streakStart = Date.now();
  let syncError: string | undefined;

  const render = () => {
    const view = panelView({
      role,
      tokenMissing,
      socketState,
      syncError,
      disconnectedMs: Date.now() - streakStart,
    });
    const status = el("status");
    status.textContent = view.message;
    status.dataset.kind = view.kind;
    el("hint").textContent = view.hint ?? "";
    el("sync-error").textContent = view.error ?? "";
  };

  if (role !== "gm" || tokenMissing) {
    render();
    return;
  }

  const sync = createEncounterSync(
    obr,
    (e) => {
      console.error("encounter sync failed", e);
      syncError = describeError(e);
      render();
    },
    () => {
      if (syncError === undefined) return;
      syncError = undefined;
      render();
    },
  );
  const socket = new ReconnectingSocket({
    url: BRIDGE_URL,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    hello: () => ({
      v: PROTOCOL_VERSION,
      type: "hello",
      payload: { role, extensionVersion: EXTENSION_VERSION, token },
    }),
    onMessage: (message) => void sync.handleMessage(message),
    onStateChange: (state) => {
      if (state === "open") streakStart = Date.now();
      else if (socketState === "open" || socketState === "closed")
        streakStart = Date.now();
      socketState = state;
      render();
    },
  });
  socket.start();
  // Re-render periodically so the stalled hint appears without a state change.
  setInterval(render, 1000);

  const showScene = (ready: boolean) => {
    el("scene").textContent = ready ? "Scene ready." : "Waiting for scene...";
  };
  showScene(await obr.isSceneReady());
  obr.onSceneReadyChange(showScene);
});
