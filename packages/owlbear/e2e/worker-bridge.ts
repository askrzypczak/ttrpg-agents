/** A real bridge child process owned by one Playwright worker. */
export interface WorkerBridge {
  origin: string;
  token: string;
  stop(): Promise<void>;
}

/**
 * Starts the real bridge CLI (`packages/bridge/dist/cli.js`, cwd `repo`) on an
 * ephemeral port, serving `staticDir`, with its token file and seeded DB in
 * `dir`. Resolves once the bridge reports its listening origin.
 */
export function startWorkerBridge(options: {
  repo: string;
  staticDir: string;
  dir: string;
}): Promise<WorkerBridge> {
  void options;
  throw new Error("not implemented");
}
