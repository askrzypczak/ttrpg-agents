// Tiny static server for the e2e harness (dist-e2e) on 127.0.0.1:5200, a
// different origin than the extension (localhost:5199), like owlbear.rodeo.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist-e2e", import.meta.url));
const port = 5200;
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  readFile(file).then(
    (body) => {
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    },
    () => res.writeHead(404).end(),
  );
}).listen(port, "127.0.0.1", () => {
  console.log(`e2e harness on http://127.0.0.1:${port}`);
});
