import type { ReactNode } from "react";
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

export function Panel(props: PanelProps): ReactNode {
  void props;
  throw new Error("not implemented");
}
