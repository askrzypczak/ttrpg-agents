/** What the table reports about its scene. */
export interface TableSceneStatus {
  sceneReady: boolean;
  tokenCount: number;
  appliedInstanceCount: number;
}

/** Driven port: ask the table (the VTT). Fails with `TableUnavailableError`. */
export interface TablePort {
  sceneStatus(): Promise<TableSceneStatus>;
}
