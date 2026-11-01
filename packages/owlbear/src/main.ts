import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
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
import { createMapOverlay } from "./overlay.js";
import { describeError, panelView, type PanelView } from "./panel-state.js";
import { tokenDeletedErrorText } from "./token-deleted.js";
import { downloadTokenImage, uploadTokenImage } from "./token-art.js";

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

  // The re-upload rows as last drawn: they are drawn again only when they
  // change, so a periodic render never replaces a button under the pointer.
  let drawnReuploads = "";
  const drawReuploads = (rows: PanelView["reuploads"]) => {
    const drawn = JSON.stringify(rows ?? []);
    if (drawn === drawnReuploads) return;
    drawnReuploads = drawn;
    el("reupload").hidden = rows === undefined;
    el("reupload-list").replaceChildren(
      ...(rows ?? []).map((row) => {
        const item = document.createElement("li");
        item.dataset.monsterKey = row.monsterKey;
        const label = document.createElement("span");
        label.textContent = row.label;
        const reupload = document.createElement("button");
        reupload.dataset.action = "reupload";
        reupload.textContent = "Re-upload";
        const pick = document.createElement("button");
        pick.dataset.action = "pick";
        pick.textContent = "Pick the uploaded image";
        pick.hidden = !row.canPick;
        const hint = document.createElement("p");
        hint.className = "reupload-hint";
        hint.textContent = row.hint ?? "";
        item.append(label, " ", reupload, " ", pick, hint);
        return item;
      }),
    );
  };

  // The Token art rows as last drawn, drawn again only when they change, like
  // the re-upload rows.
  let drawnTypeArt = "";
  const drawTypeArt = (rows: PanelView["typeArt"]) => {
    const drawn = JSON.stringify(rows ?? []);
    if (drawn === drawnTypeArt) return;
    drawnTypeArt = drawn;
    el("type-art").hidden = rows === undefined;
    el("type-art-list").replaceChildren(
      ...(rows ?? []).map((row) => {
        const item = document.createElement("li");
        item.dataset.monsterKey = row.monsterKey;
        const label = document.createElement("span");
        label.textContent = row.label;
        const pick = document.createElement("button");
        pick.dataset.action = "pick-art";
        pick.textContent = "Pick art";
        const upload = document.createElement("button");
        upload.dataset.action = "upload-art";
        upload.textContent = "Upload new art";
        const pickUpload = document.createElement("button");
        pickUpload.dataset.action = "pick-upload";
        pickUpload.textContent = "Pick the uploaded image";
        pickUpload.hidden = !row.canPick;
        const hint = document.createElement("p");
        hint.className = "type-art-hint";
        hint.textContent = row.hint ?? "";
        hint.hidden = row.hint === undefined;
        item.append(label, " ", pick, " ", upload, " ", pickUpload, hint);
        return item;
      }),
    );
  };

  let rejection: RejectionCode | undefined;
  const render = () => {
    const view = panelView({
      role,
      tokenMissing,
      socketState,
      ...(rejection ? { rejection } : {}),
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
    const status = el("status");
    status.textContent = view.message;
    status.dataset.kind = view.kind;
    el("hint").textContent = view.hint ?? "";
    el("art-prompt").textContent = view.prompt ?? "";
    drawReuploads(view.reuploads);
    drawTypeArt(view.typeArt);
    el("use-this-tab").hidden = view.action !== "use-this-tab";
    el("sync-error").textContent = view.error ?? "";
    el("edit-note").textContent = view.note ?? "";
    el("overrides").hidden = view.overrides === undefined;
    el("overrides-list").replaceChildren(
      ...(view.overrides ?? []).map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      }),
    );
  };

  if (role !== "gm" || tokenMissing) {
    render();
    return;
  }

  // The map overlay: local items for this tab only, on at every load.
  const overlay = createMapOverlay(obr, {
    onError: (e) => console.error("map overlay failed", e),
  });
  const overlayToggle = el("overlay-toggle") as HTMLInputElement;
  overlayToggle.checked = true;
  el("overlay").hidden = false;
  overlayToggle.addEventListener("change", () => {
    void overlay.setEnabled(overlayToggle.checked);
  });

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
      storeImage: (bytes) => uploadTokenImage(bytes, token),
      onArtStoreFailed: (text) => {
        artError = text;
        render();
      },
      loadImage: (sha256) => downloadTokenImage(sha256, token),
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
      payload: { role, extensionVersion: EXTENSION_VERSION, token },
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
  reconnect = () => {
    socket.close();
    socket.start();
  };
  el("use-this-tab").addEventListener("click", reconnect);
  el("dismiss-overrides").addEventListener("click", () => {
    overrides.length = 0;
    render();
  });
  // The re-upload rows' buttons; nothing in the sync waits on them.
  el("reupload-list").addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("button[data-action]")
        : null;
    const monsterKey = button?.closest<HTMLElement>("li")?.dataset.monsterKey;
    if (button === null || monsterKey === undefined) return;
    if (button.dataset.action === "reupload") void sync.reuploadArt(monsterKey);
    else if (button.dataset.action === "pick")
      void sync.pickUploadedArt(monsterKey);
  });
  // The Token art rows' buttons; nothing in the sync waits on them either.
  // The file chooser of "Upload new art" answers for the row that opened it.
  const artFile = el("art-file") as HTMLInputElement;
  let uploadFor: string | undefined;
  el("type-art-list").addEventListener("click", (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("button[data-action]")
        : null;
    const monsterKey = button?.closest<HTMLElement>("li")?.dataset.monsterKey;
    if (button === null || monsterKey === undefined) return;
    if (button.dataset.action === "pick-art") void sync.repickArt(monsterKey);
    else if (button.dataset.action === "upload-art") {
      uploadFor = monsterKey;
      artFile.click();
    } else if (button.dataset.action === "pick-upload")
      void sync.pickUploadedFile(monsterKey);
  });
  artFile.addEventListener("change", () => {
    const file = artFile.files?.[0];
    // Cleared so that the same file can be chosen again.
    artFile.value = "";
    const monsterKey = uploadFor;
    uploadFor = undefined;
    if (file !== undefined && monsterKey !== undefined)
      void sync.uploadArtFile(monsterKey, file);
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
