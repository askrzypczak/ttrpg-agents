import OBR from "@owlbear-rodeo/sdk";
import {
  PROTOCOL_VERSION,
  ReconnectingSocket,
  type SocketLike,
  type SocketState,
} from "@ttrpg-agents/core/bridge";
import { panelView, type PlayerRole } from "./panel-state.js";

const BRIDGE_URL = "ws://localhost:5199/ws";
const EXTENSION_VERSION = "0.0.0";

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found;
}

OBR.onReady(async () => {
  const role: PlayerRole =
    (await OBR.player.getRole()) === "GM" ? "gm" : "player";

  let socketState: SocketState = "connecting";
  let streakStart = Date.now();

  const render = () => {
    const view = panelView({
      role,
      socketState,
      disconnectedMs: Date.now() - streakStart,
    });
    const status = el("status");
    status.textContent = view.message;
    status.dataset.kind = view.kind;
    el("hint").textContent = view.hint ?? "";
  };

  if (role !== "gm") {
    render();
    return;
  }

  const socket = new ReconnectingSocket({
    url: BRIDGE_URL,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    hello: () => ({
      v: PROTOCOL_VERSION,
      type: "hello",
      payload: { role, extensionVersion: EXTENSION_VERSION },
    }),
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
  showScene(await OBR.scene.isReady());
  OBR.scene.onReadyChange(showScene);
});
