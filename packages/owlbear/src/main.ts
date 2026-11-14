import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  ReconnectingSocket,
  type RejectionCode,
  type SocketLike,
  type SocketState,
} from "./reconnecting-socket.js";
import { replyToQuery } from "./queries.js";
import {
  createEncounterSync,
  type ArtStep,
  type Reupload,
  type TypeArt,
} from "./encounter-sync.js";
import { createObrAdapter } from "./obr-adapter.js";
import { instanceEditErrorText } from "./instance-edit.js";
import { createOpenSceneReporter } from "./open-scene.js";
import { createMapOverlay } from "./overlay.js";
import { Panel, type PanelActions } from "./panel.js";
import { describeError, panelView, sceneEncounter } from "./panel-state.js";
import { tokenDeletedErrorText } from "./token-deleted.js";
import { downloadTokenImage, uploadTokenImage } from "./token-art.js";

const EXTENSION_VERSION = "0.0.0";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("missing element #root");
const root = createRoot(rootElement);

// Until the sync and socket exist, the panel's controls do nothing.
const noActions: PanelActions = {
  useThisTab: () => {},
  dismissOverrides: () => {},
  reuploadArt: () => {},
  pickUploadedArt: () => {},
  repickArt: () => {},
  uploadArtFile: () => {},
  pickUploadedFile: () => {},
  setOverlayEnabled: () => {},
};

// "Starting..." until Owlbear is ready.
root.render(createElement(Panel, { view: undefined, actions: noActions }));

const obr = createObrAdapter();

obr.onReady(async () => {
  const role = await obr.getRole();

  let socketState: SocketState = "connecting";
  let streakStart = Date.now();
  let syncError: string | undefined;
  let removeError: string | undefined;
  let editError: string | undefined;
  let editNote: string | undefined;
  // The latest failure to store the bytes of token art (after a pick, or on
  // connect for art without stored bytes) or to load or upload stored bytes
  // for a re-upload. Kept until the panel reloads (no store change clears
  // it); a later failure replaces it.
  let artError: string | undefined;
  // The fresh image picker open now, if any.
  let artStep: ArtStep | undefined;
  // The monster types whose stored art needs re-uploading.
  let reuploads: Reupload[] = [];
  // The encounter's monster types, with their art state.
  let typeArt: TypeArt[] = [];
  let waitingCommands = 0;
  // Store values a snapshot wrote over the table's, until the DM dismisses
  // them. In memory only: a reload starts with its own.
  const overrides: string[] = [];

  // Scene readiness once known, and whether the map overlay toggle shows.
  let sceneReady: boolean | undefined;
  let showOverlayToggle = false;
  let actions = noActions;

  // The open scene's encounter name (see sceneEncounter); GM only.
  let openSceneEncounter: () => string | null | undefined = () => undefined;

  let rejection: RejectionCode | undefined;
  const render = () => {
    const encounter = openSceneEncounter();
    const view = panelView({
      role,
      socketState,
      ...(rejection ? { rejection } : {}),
      ...(encounter !== undefined ? { sceneEncounter: encounter } : {}),
      syncError,
      ...(removeError !== undefined ? { removeError } : {}),
      ...(editError !== undefined ? { editError } : {}),
      ...(artError !== undefined ? { artError } : {}),
      ...(artStep !== undefined ? { artStep } : {}),
      reuploads,
      typeArt,
      ...(editNote !== undefined ? { editNote } : {}),
      waitingCommands,
      overrides,
      disconnectedMs: Date.now() - streakStart,
    });
    root.render(
      createElement(Panel, { view, sceneReady, showOverlayToggle, actions }),
    );
  };

  if (role !== "gm") {
    render();
    return;
  }

  // The map overlay: local items for this tab only, on at every load.
  const overlay = createMapOverlay(obr, {
    onError: (e) => console.error("map overlay failed", e),
  });
  showOverlayToggle = true;

  // The socket is created after the sync, which reports deletions and gaps through it.
  let sendToBridge: (message: BridgeMessage) => boolean = () => false;
  let reconnect: () => void = () => {};
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
      send: (message) => sendToBridge(message),
      onWaitingChange: (waiting) => {
        waitingCommands = waiting;
        render();
      },
      onOverride: (text) => {
        overrides.push(text);
        render();
      },
      onEditRejected: (text) => {
        editError = text;
        render();
      },
      onEditRejectedCleared: (text) => {
        if (editError !== text) return;
        editError = undefined;
        render();
      },
      onEditDiffers: (text) => {
        editNote = text;
        render();
      },
      storeImage: (bytes) => uploadTokenImage(bytes),
      onArtStoreFailed: (text) => {
        artError = text;
        render();
      },
      loadImage: (sha256) => downloadTokenImage(sha256),
      onArtRepublishFailed: (text) => {
        artError = text;
        render();
      },
      // The GM is told which picker is open; the panel opens so they see it.
      onArtStep: (step) => {
        artStep = step;
        render();
        if (step !== undefined) void obr.openPanel();
      },
      // The panel opens when a type joins the list, so the GM sees what to
      // re-upload.
      onReuploadsChange: (list) => {
        const joined = list.some(
          (row) => !reuploads.some((r) => r.monsterKey === row.monsterKey),
        );
        reuploads = list;
        render();
        if (joined) void obr.openPanel();
      },
      // Unlike the re-upload list, this one never opens the panel.
      onTypeArtChange: (list) => {
        typeArt = list;
        render();
      },
      // The override list stays: only the DM dismisses it.
      onStoreChange: () => {
        removeError = undefined;
        editError = undefined;
        editNote = undefined;
        render();
      },
      // A missed event: reconnect, which brings a fresh snapshot.
      onGap: () => reconnect(),
    },
  );
  const socket = new ReconnectingSocket({
    url: `ws://${location.host}/ws`,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    hello: () => ({
      v: PROTOCOL_VERSION,
      type: "hello",
      payload: { role, extensionVersion: EXTENSION_VERSION },
    }),
    onMessage: (message) => {
      if (message.type === "map-rooms") {
        void overlay.setRooms(message.payload);
        return;
      }
      if (message.type === "query" && message.id !== undefined) {
        void replyToQuery(obr, sync, message.id, message.payload).then(
          (reply) => socket.send(reply),
        );
        return;
      }
      const text = tokenDeletedErrorText(message);
      if (text !== undefined) {
        removeError = text;
        render();
      }
      const editText = instanceEditErrorText(message);
      if (editText !== undefined) {
        editError = editText;
        render();
      }
      void sync.handleMessage(message);
      // After the sync: queued commands go out before the scene-open.
      if (message.type === "hello-ack") void reporter.helloAck();
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
  // Reports the open scene (minting its id once) so the bridge sends the
  // snapshot of the encounter bound to it.
  const reporter = createOpenSceneReporter(obr, sendToBridge, {
    onChange: () => render(),
  });
  openSceneEncounter = () =>
    sceneEncounter(reporter.current(), sync.heldScene());
  reconnect = () => {
    socket.close();
    socket.start();
  };
  // Nothing in the sync waits on the panel's buttons.
  actions = {
    useThisTab: () => reconnect(),
    dismissOverrides: () => {
      overrides.length = 0;
      render();
    },
    reuploadArt: (monsterKey) => void sync.reuploadArt(monsterKey),
    pickUploadedArt: (monsterKey) => void sync.pickUploadedArt(monsterKey),
    repickArt: (monsterKey) => void sync.repickArt(monsterKey),
    uploadArtFile: (monsterKey, file) =>
      void sync.uploadArtFile(monsterKey, file),
    pickUploadedFile: (monsterKey) => void sync.pickUploadedFile(monsterKey),
    setOverlayEnabled: (enabled) => void overlay.setEnabled(enabled),
  };
  socket.start();
  // Re-render periodically so the stalled hint appears without a state change.
  setInterval(render, 1000);

  const showScene = (ready: boolean) => {
    sceneReady = ready;
    render();
  };
  showScene(await obr.isSceneReady());
  obr.onSceneReadyChange(showScene);
});
