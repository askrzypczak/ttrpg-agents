import { describe, expect, it } from "vitest";
import type { EncounterRepository } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { editInstance } from "./encounter-bridge.js";

const repoWith = (over: Partial<EncounterRepository>): EncounterRepository =>
  ({
    listInstances: () => [makeTestInstance({ id: "i1" })],
    ...over,
  }) as EncounterRepository;

describe("editInstance", () => {
  it("editInstance maps a domain error to a refusal with its code", () => {
    const result = editInstance(repoWith({ listInstances: () => [] }), {
      instanceId: "i1",
      currentHp: 3,
    });

    expect(result).toMatchObject({ ok: false, code: "unknown_instance" });
  });

  it("editInstance rethrows an error that is not a domain error", () => {
    const repo = repoWith({
      setHp: () => {
        throw new Error("database is locked");
      },
    });

    expect(() =>
      editInstance(repo, { instanceId: "i1", currentHp: 3 }),
    ).toThrow("database is locked");
  });
});
