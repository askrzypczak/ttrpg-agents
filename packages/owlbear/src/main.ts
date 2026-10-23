import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
import {
  ReconnectingSocket,
  type RejectionCode,
  type SocketLike,
  type SocketState,
} from "./reconnecting-socket.js";
import { replyToQuery } from "./queries.js";
import { createEncounterSync } from "./encounter-sync.js";
import { createObrAdapter } from "./obr-adapter.js";
import { describeError, panelView } from "./panel-state.js";
import { tokenArtMessage } from "./token-art.js";
import { tokenDeletedErrorText, tokenDeletedMessage } from "./token-deleted.js";

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
  let removeError: string | undefined;

  let rejection: RejectionCode | undefined;
  const render = () => {
    const view = panelView({
      role,
      tokenMissing,
      socketState,
      ...(rejection ? { rejection } : {}),
      syncError,
      ...(removeError !== undefined ? { removeError } : {}),
      disconnectedMs: Date.now() - streakStart,
    });
    const status = el("status");
    status.textContent = view.message;
    status.dataset.kind = view.kind;
    el("hint").textContent = view.hint ?? "";
    el("use-this-tab").hidden = view.action !== "use-this-tab";
    el("sync-error").textContent = view.error ?? "";
  };

  if (role !== "gm" || tokenMissing) {
    render();
    return;
  }

  // The socket is created after the sync, which reports deletions through it.
  let sendToBridge: (message: BridgeMessage) => void = () => {};
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
    {
      onTokenDeleted: (id) => sendToBridge(tokenDeletedMessage(id)),
      onTokenArt: (monsterKey, art) =>
        sendToBridge(tokenArtMessage(monsterKey, art)),
    },
  );
  const socket = new ReconnectingSocket({
    url: `ws://${location.host}/ws`,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    hello: () => ({
      v: PROTOCOL_VERSION,
      type: "hello",
      payload: { role, extensionVersion: EXTENSION_VERSION, token },
    }),
    onMessage: (message) => {
      if (message.type === "query" && message.id !== undefined) {
        void replyToQuery(obr, sync, message.id, message.payload).then(
          (reply) => socket.send(reply),
        );
        return;
      }
      if (message.type === "encounter-snapshot") {
        removeError = undefined;
        render();
      } else {
        const text = tokenDeletedErrorText(message);
        if (text !== undefined) {
          removeError = text;
          render();
        }
      }
      void sync.handleMessage(message);
    },
    onStateChange: (state) => {
      if (state === "open") streakStart = Date.now();
      else if (socketState === "open" || socketState === "closed")
        streakStart = Date.now();
      socketState = state;
      rejection = socket.rejection ?? undefined;
      render();
    },
  });
  sendToBridge = (message) => socket.send(message);
  el("use-this-tab").addEventListener("click", () => {
    socket.close();
    socket.start();
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
