import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Reads the persistent bridge token, creating it (mode 0600) on first use. */
export async function loadOrCreateToken(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) {
      await chmod(path, 0o600);
      return existing;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, token + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}
