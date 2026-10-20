import { execFileSync } from "node:child_process";

// mcp resolves core, and bridge resolves core and protocol, through their
// built dist/. The stdio and bridge live-sync tests spawn mcp's dist/. Refresh
// them before any test runs; a no-op when they are current.
export default function setup(): void {
  execFileSync("npm", ["run", "build:ts", "--silent"], { stdio: "inherit" });
}
