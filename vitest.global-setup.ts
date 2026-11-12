import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTINGS } from "./packages/config/src/config.ts";

// mcp resolves engine, and bridge resolves engine and protocol, through their
// built dist/. The stdio and bridge live-sync tests spawn mcp's dist/. Refresh
// them before any test runs; a no-op when they are current.
//
// Then point both XDG directories into a run temp dir and drop every setting
// variable, so no test, and no process a test spawns, opens either profile's
// real files. Test workers inherit process.env as it is after this setup.
export default function setup(): () => void {
  execFileSync("npm", ["run", "build:ts", "--silent"], { stdio: "inherit" });
  const run = mkdtempSync(join(tmpdir(), "ttrpg-agents-test-"));
  process.env.XDG_CONFIG_HOME = join(run, "config");
  process.env.XDG_DATA_HOME = join(run, "data");
  for (const spec of SETTINGS) delete process.env[spec.env];
  return () => rmSync(run, { recursive: true, force: true });
}
