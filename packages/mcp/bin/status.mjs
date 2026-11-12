import { existsSync } from "node:fs";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const url = new URL("../dist/status-cli.js", import.meta.url);

if (!existsSync(fileURLToPath(url))) {
  process.stderr.write("ttrpg-agents status: run `npm run build` first\n");
  process.exit(1);
}

await import(url.href);
