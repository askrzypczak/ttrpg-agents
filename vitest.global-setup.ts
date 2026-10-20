import { execFileSync } from "node:child_process";

// mcp resolves core through its built dist/, and its stdio test spawns mcp's
// dist/. Refresh both before any test runs; a no-op when they are current.
export default function setup(): void {
  execFileSync("npm", ["run", "build:ts", "--silent"], { stdio: "inherit" });
}
