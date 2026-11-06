import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readStateFile,
  removeStateFile,
  writeStateFile,
  type BridgeState,
} from "./state-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-state-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const record = (pid: number): BridgeState => ({
  pid,
  port: 5199,
  checkout: "/somewhere/ttrpg-agents",
  commit: "0123456789abcdef0123456789abcdef01234567",
  startedAt: new Date("2026-11-06T10:00:00.000Z").toISOString(),
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("bridge state file", () => {
  it("readStateFile returns null for a missing file and for one that is not a valid record", async () => {
    expect(await readStateFile(join(dir, "missing.json"))).toBeNull();

    const notJson = join(dir, "not-json.json");
    await writeFile(notJson, "this is not json");
    expect(await readStateFile(notJson)).toBeNull();

    const wrongShape = join(dir, "wrong-shape.json");
    await writeFile(wrongShape, JSON.stringify({ pid: "123", port: 5199 }));
    expect(await readStateFile(wrongShape)).toBeNull();

    const notObject = join(dir, "array.json");
    await writeFile(notObject, JSON.stringify([1, 2, 3]));
    expect(await readStateFile(notObject)).toBeNull();

    const valid = join(dir, "valid.json");
    await writeStateFile(valid, record(4242));
    expect(await readStateFile(valid)).toEqual(record(4242));
  });

  it("removeStateFile leaves a record of another pid in place", async () => {
    const path = join(dir, "bridge-state.json");
    await writeStateFile(path, record(1111));

    await removeStateFile(path, 2222);
    expect(await readStateFile(path)).toEqual(record(1111));

    await removeStateFile(path, 1111);
    expect(await exists(path)).toBe(false);

    await expect(removeStateFile(path, 1111)).resolves.toBeUndefined();
  });
});
