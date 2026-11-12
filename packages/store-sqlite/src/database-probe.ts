import type { DatabaseProbe } from "@ttrpg-agents/engine";

/** Reads the schema version of the database at `path` read-only; never creates or migrates it. */
export function createDatabaseProbe(path: string): DatabaseProbe {
  void path;
  return {
    check() {
      throw new Error("not implemented");
    },
  };
}
