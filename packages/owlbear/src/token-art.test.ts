import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage } from "@ttrpg-agents/protocol";
import { tokenArtMessage } from "./token-art.js";

const art = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

describe("tokenArtMessage", () => {
  it("tokenArtMessage builds a token-art-set envelope that the protocol decodes with the art", () => {
    const decoded = decodeMessage(
      encodeMessage(tokenArtMessage("shadow", art)),
    );
    expect(decoded).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "token-art-set",
        payload: { monsterKey: "shadow", art },
      },
    });
  });
});
