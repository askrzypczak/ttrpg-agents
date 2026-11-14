import { describe, expect, it } from "vitest";
import type {
  EncounterDirectory,
  EncounterRepository,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { editInstance } from "./encounter-bridge.js";

const repoWith = (over: Partial<EncounterRepository>): EncounterRepository =>
  ({
    listInstances: () => [makeTestInstance({ id: "i1" })],
    ...over,
  }) as EncounterRepository;

/** A directory whose one encounter holds every instance, read through `repo`. */
const directoryOf = (repo: EncounterRepository): EncounterDirectory =>
  ({
    findEncounterOfInstance: () => ({
      id: "e1",
      name: "Encounter 1",
      createdAt: 0,
    }),
    repositoryFor: () => repo,
  }) as unknown as EncounterDirectory;

describe("editInstance", () => {
  it("editInstance maps a domain error to a refusal with its code", () => {
    const result = editInstance(
      directoryOf(repoWith({ listInstances: () => [] })),
      { instanceId: "i1", currentHp: 3 },
      "test",
    );

    expect(result).toMatchObject({ ok: false, code: "unknown_instance" });
  });

  it("editInstance rethrows an error that is not a domain error", () => {
    const repo = repoWith({
      setHp: () => {
        throw new Error("database is locked");
      },
    });

    expect(() =>
      editInstance(
        directoryOf(repo),
        { instanceId: "i1", currentHp: 3 },
        "test",
      ),
    ).toThrow("database is locked");
  });
});
