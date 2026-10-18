import { describe, expect, it } from "vitest";
import { createFakeObr } from "./fake-adapter.js";
import {
  INITIATIVE_METADATA_KEY,
  initiativeMetadata,
  writeInitiativeMetadata,
} from "./initiative.js";

describe("initiativeMetadata", () => {
  it("registers a token with its initiative as a string count, not active", () => {
    expect(initiativeMetadata(14)).toEqual({
      [INITIATIVE_METADATA_KEY]: { count: "14", active: false },
    });
  });

  it("keeps zero and negative initiative as their string counts", () => {
    expect(initiativeMetadata(0)).toEqual({
      [INITIATIVE_METADATA_KEY]: { count: "0", active: false },
    });
    expect(initiativeMetadata(-1)).toEqual({
      [INITIATIVE_METADATA_KEY]: { count: "-1", active: false },
    });
  });

  it("is empty when there is no initiative, so the token is not listed", () => {
    expect(initiativeMetadata(null)).toEqual({});
    expect(Object.keys(initiativeMetadata(null))).toEqual([]);
  });
});

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
