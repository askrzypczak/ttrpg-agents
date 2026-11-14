import { useRef, type ReactNode } from "react";
import type { PanelView } from "./panel-state.js";

/** What the panel's controls do; main.ts wires them to the sync, socket and overlay. */
export interface PanelActions {
  useThisTab(): void;
  dismissOverrides(): void;
  reuploadArt(monsterKey: string): void;
  pickUploadedArt(monsterKey: string): void;
  repickArt(monsterKey: string): void;
  uploadArtFile(monsterKey: string, file: File): void;
  pickUploadedFile(monsterKey: string): void;
  setOverlayEnabled(enabled: boolean): void;
}

export interface PanelProps {
  /** What the panel shows; undefined until Owlbear is ready ("Starting..."). */
  view: PanelView | undefined;
  /** Scene readiness once known; undefined shows nothing. */
  sceneReady?: boolean;
  /** Shows the map overlay toggle (a GM with a token). */
  showOverlayToggle?: boolean;
  actions: PanelActions;
}

/**
 * The extension's panel. Every section stays mounted and is shown or hidden,
 * and rows are keyed by monster type, so a re-render with the same view keeps
 * every element (no button is replaced under the pointer).
 */
export function Panel({
  view,
  sceneReady,
  showOverlayToggle,
  actions,
}: PanelProps): ReactNode {
  const artFile = useRef<HTMLInputElement>(null);
  // The row whose "Upload new art" opened the file chooser.
  const uploadFor = useRef<string | undefined>(undefined);

  const openFileChooser = (monsterKey: string) => {
    uploadFor.current = monsterKey;
    artFile.current?.click();
  };

  const onArtFileChange = () => {
    const input = artFile.current;
    if (input === null) return;
    const file = input.files?.[0];
    // Cleared so that the same file can be chosen again.
    input.value = "";
    const monsterKey = uploadFor.current;
    uploadFor.current = undefined;
    if (file !== undefined && monsterKey !== undefined)
      actions.uploadArtFile(monsterKey, file);
  };

  const scene =
    sceneReady === undefined
      ? ""
      : sceneReady
        ? "Scene ready."
        : "Waiting for scene...";

  return (
    <>
      <h3>ttrpg-agents</h3>
      <p id="status" data-kind={view?.kind}>
        {view === undefined ? "Starting..." : view.message}
      </p>
      <p id="art-prompt">{view?.prompt}</p>
      <div id="reupload" hidden={view?.reuploads === undefined}>
        <p>
          <strong>Token art to re-upload.</strong> These monster types are drawn
          as circles until their art is re-uploaded:
        </p>
        <ul id="reupload-list">
          {(view?.reuploads ?? []).map((row) => (
            <li key={row.monsterKey} data-monster-key={row.monsterKey}>
              <span>{row.label}</span>{" "}
              <button
                data-action="reupload"
                onClick={() => actions.reuploadArt(row.monsterKey)}
              >
                Re-upload
              </button>{" "}
              <button
                data-action="pick"
                hidden={!row.canPick}
                onClick={() => actions.pickUploadedArt(row.monsterKey)}
              >
                Pick the uploaded image
              </button>
              <p className="reupload-hint">{row.hint}</p>
            </li>
          ))}
        </ul>
      </div>
      <p id="hint">{view?.hint}</p>
      <button
        id="use-this-tab"
        hidden={view?.action !== "use-this-tab"}
        onClick={() => actions.useThisTab()}
      >
        Use this tab
      </button>
      <p id="sync-error">{view?.error}</p>
      <p id="edit-note">{view?.note}</p>
      <div id="overrides" hidden={view?.overrides === undefined}>
        <p>
          Table values written over: by a snapshot (connect, reconnect or a
          skipped change), which cannot tell an MCP change made meanwhile from a
          clamped value, by an agent move of a token that had been moved on the
          table, by a redraw for an agent's monster change of a token whose art
          or size had been changed on the table or that had to be replaced with
          a new token (its attachments deleted), or by any redraw of a token
          with art you picked again in this panel:
        </p>
        <ul id="overrides-list">
          {(view?.overrides ?? []).map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
        <button
          id="dismiss-overrides"
          onClick={() => actions.dismissOverrides()}
        >
          Dismiss
        </button>
      </div>
      <div id="type-art" hidden={view?.typeArt === undefined}>
        <p>
          <strong>Token art.</strong> Pick art opens Owlbear's image picker for
          a monster type; Upload new art adds an image file to Owlbear's
          library, and Pick the uploaded image then picks it. A pick redraws the
          type's tokens with the new art.
        </p>
        <ul id="type-art-list">
          {(view?.typeArt ?? []).map((row) => (
            <li key={row.monsterKey} data-monster-key={row.monsterKey}>
              <span>{row.label}</span>{" "}
              <button
                data-action="pick-art"
                onClick={() => actions.repickArt(row.monsterKey)}
              >
                Pick art
              </button>{" "}
              <button
                data-action="upload-art"
                onClick={() => openFileChooser(row.monsterKey)}
              >
                Upload new art
              </button>{" "}
              <button
                data-action="pick-upload"
                hidden={!row.canPick}
                onClick={() => actions.pickUploadedFile(row.monsterKey)}
              >
                Pick the uploaded image
              </button>
              <p className="type-art-hint" hidden={row.hint === undefined}>
                {row.hint}
              </p>
            </li>
          ))}
        </ul>
        <input
          type="file"
          id="art-file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          ref={artFile}
          onChange={onArtFileChange}
        />
      </div>
      <p id="encounter">{view?.encounter}</p>
      <p id="scene">{scene}</p>
      <label id="overlay" hidden={!showOverlayToggle}>
        <input
          type="checkbox"
          id="overlay-toggle"
          defaultChecked
          autoComplete="off"
          onChange={(event) => actions.setOverlayEnabled(event.target.checked)}
        />{" "}
        Show map grid and rooms
      </label>
    </>
  );
}
