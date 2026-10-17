import { describe, expect, it } from "vitest";
import { createFakeObr } from "./fake-adapter.js";
import {
  INITIATIVE_METADATA_KEY,
  writeInitiativeMetadata,
} from "./initiative.js";

describe("writeInitiativeMetadata", () => {
  it("uses the initiative tracker's exact metadata key", () => {
    expect(INITIATIVE_METADATA_KEY).toBe(
      "rodeo.owlbear.initiative-tracker/metadata",
    );
  });

  it("writes under the key and preserves other scene metadata", async () => {
    const { obr, scene } = createFakeObr();
    await obr.setSceneMetadata({ "other.ext/metadata": { keep: true } });
    const value = { round: 1, turn: "t1" };
    await writeInitiativeMetadata(obr, value);
    expect(scene.getMetadata()).toEqual({
      "other.ext/metadata": { keep: true },
      "rodeo.owlbear.initiative-tracker/metadata": value,
    });
  });
});
