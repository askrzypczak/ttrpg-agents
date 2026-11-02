import { describe, expect, it } from "vitest";
import {
  STALLED_HINT,
  describeError,
  panelView,
  type PanelInput,
} from "./panel-state.js";

describe("panelView", () => {
  it("shows a gm-only notice to players regardless of socket state", () => {
    const v = panelView({
      role: "player",
      socketState: "open",
      disconnectedMs: 0,
    });
    expect(v.kind).toBe("gm-only");
    expect(v.hint).toBeUndefined();
  });

  it("asks the GM to reinstall when the token is missing", () => {
    const v = panelView({
      role: "gm",
      socketState: "connecting",
      disconnectedMs: 0,
      tokenMissing: true,
    });
    expect(v.kind).toBe("token-missing");
    expect(v.message).toContain("reinstall");
  });

  it("shows connected for the GM when open", () => {
    const v = panelView({ role: "gm", socketState: "open", disconnectedMs: 0 });
    expect(v.kind).toBe("connected");
  });

  it("shows closed", () => {
    const v = panelView({
      role: "gm",
      socketState: "closed",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("closed");
    expect(v.hint).toBeUndefined();
  });

  it("shows connecting and reconnecting without a hint before the threshold", () => {
    for (const socketState of ["connecting", "reconnecting"] as const) {
      const v = panelView({ role: "gm", socketState, disconnectedMs: 7999 });
      expect(v.kind).toBe(socketState);
      expect(v.hint).toBeUndefined();
    }
  });

  it("adds the local-network hint at the threshold", () => {
    for (const socketState of ["connecting", "reconnecting"] as const) {
      const v = panelView({ role: "gm", socketState, disconnectedMs: 8000 });
      expect(v.kind).toBe(socketState);
      expect(v.hint).toBe(STALLED_HINT);
    }
    expect(STALLED_HINT).toMatch(/local network/i);
  });

  it("honours a custom threshold", () => {
    const v = panelView({
      role: "gm",
      socketState: "connecting",
      disconnectedMs: 1000,
      stalledAfterMs: 1000,
    });
    expect(v.hint).toBeDefined();
  });

  it("a bad-token rejection shows the reinstall message with no stalled hint", () => {
    const v = panelView({
      role: "gm",
      socketState: "rejected",
      rejection: "bad-token",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("rejected-token");
    expect(v.message).toContain("reinstall");
    expect(v.hint).toBeUndefined();
  });

  it("a version rejection shows the rebuild message with no stalled hint", () => {
    const v = panelView({
      role: "gm",
      socketState: "rejected",
      rejection: "unsupported-version",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("rejected-version");
    expect(v.message).toContain("rebuild");
    expect(v.hint).toBeUndefined();
  });

  it('rejected with superseded shows kind superseded, message "Connected in another tab.", action use-this-tab and no hint', () => {
    const v = panelView({
      role: "gm",
      socketState: "rejected",
      rejection: "superseded",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("superseded");
    expect(v.message).toBe("Connected in another tab.");
    expect(v.action).toBe("use-this-tab");
    expect(v.hint).toBeUndefined();
  });
});

describe("panelView sync error", () => {
  it("shows the sync failure on connection views", () => {
    const v = panelView({
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
      syncError: "boom",
    });
    expect(v.kind).toBe("connected");
    expect(v.error).toBe("Encounter sync failed: boom");
  });

  it("has no error without a sync failure", () => {
    const v = panelView({ role: "gm", socketState: "open", disconnectedMs: 0 });
    expect(v.error).toBeUndefined();
  });

  it("leaves gm-only and token-missing views unaffected", () => {
    const base: PanelInput = {
      role: "player",
      socketState: "open",
      disconnectedMs: 0,
      syncError: "x",
    };
    const player = panelView(base);
    expect(player.kind).toBe("gm-only");
    expect(player.error).toBeUndefined();
    const noToken = panelView({ ...base, role: "gm", tokenMissing: true });
    expect(noToken.kind).toBe("token-missing");
    expect(noToken.error).toBeUndefined();
  });
});

describe("panelView remove error", () => {
  it("a removeError shows as the panel error, together with a syncError, and not for gm-only or token-missing", () => {
    const removeError = "Could not remove i7 from the encounter: gone";
    const base: PanelInput = {
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
      removeError,
    };
    const alone = panelView(base);
    expect(alone.kind).toBe("connected");
    expect(alone.error).toContain(removeError);

    const both = panelView({ ...base, syncError: "boom" });
    expect(both.error).toContain(removeError);
    expect(both.error).toContain("Encounter sync failed: boom");

    const player = panelView({ ...base, role: "player", syncError: "boom" });
    expect(player.kind).toBe("gm-only");
    expect(player.error).toBeUndefined();
    const noToken = panelView({ ...base, tokenMissing: true });
    expect(noToken.kind).toBe("token-missing");
    expect(noToken.error).toBeUndefined();
  });
});

describe("panelView art error", () => {
  it("an art upload failure shows in the error line", () => {
    const artError =
      "Could not store the image of the token art for shadow; it is kept as a link: fetch failed";
    const base: PanelInput = {
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
      artError,
    };
    const alone = panelView(base);
    expect(alone.kind).toBe("connected");
    expect(alone.error).toContain(artError);

    const withOthers = panelView({
      ...base,
      syncError: "boom",
      removeError: "Could not remove i7 from the encounter: gone",
    });
    expect(withOthers.error).toContain(artError);
    expect(withOthers.error).toContain("Encounter sync failed: boom");
    expect(withOthers.error).toContain(
      "Could not remove i7 from the encounter: gone",
    );

    const player = panelView({ ...base, role: "player" });
    expect(player.error).toBeUndefined();
  });
});

describe("panelView art steps", () => {
  it("the art step prompt names the monster and its step count", () => {
    const artStep = { monsterName: "Ogre", index: 1, total: 2 };
    for (const socketState of ["open", "connecting"] as const) {
      const v = panelView({
        role: "gm",
        socketState,
        disconnectedMs: 0,
        artStep,
      });
      expect(v.prompt).toBe(
        "Art 1 of 2: choose the token art for Ogre in Owlbear's image picker, or cancel it to use circles.",
      );
    }
    expect(
      panelView({
        role: "gm",
        socketState: "open",
        disconnectedMs: 0,
        artStep: { monsterName: "Wolf", index: 2, total: 2 },
      }).prompt,
    ).toBe(
      "Art 2 of 2: choose the token art for Wolf in Owlbear's image picker, or cancel it to use circles.",
    );

    const none = panelView({
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
    });
    expect(none.prompt).toBeUndefined();

    const player = panelView({
      role: "player",
      socketState: "open",
      disconnectedMs: 0,
      artStep,
    });
    expect(player.kind).toBe("gm-only");
    expect(player.prompt).toBeUndefined();
  });

  it("each type to re-upload is listed with its monster name and count, and once uploaded tells the GM to confirm the folder and pick the named image, and offers the pick", () => {
    const wolfName = `ttrpg-art-${"c3".repeat(8)}`;
    const owlbearName = `ttrpg-art-${"d4".repeat(8)}`;
    const v = panelView({
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
      reuploads: [
        {
          monsterKey: "wolf",
          monsterName: "Wolf",
          assetName: wolfName,
          uploaded: false,
        },
        {
          monsterKey: "owlbear",
          monsterName: "Owlbear",
          assetName: owlbearName,
          uploaded: true,
        },
      ],
    });

    expect(v.reuploads).toEqual([
      { monsterKey: "wolf", label: "Wolf (1 of 2)", canPick: false },
      {
        monsterKey: "owlbear",
        label: "Owlbear (2 of 2)",
        hint: `Confirm the folder in Owlbear's upload dialog, then press "Pick the uploaded image" and pick ${owlbearName}.`,
        canPick: true,
      },
    ]);

    const none = panelView({
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
      reuploads: [],
    });
    expect(none.reuploads ?? []).toEqual([]);

    const player = panelView({
      role: "player",
      socketState: "open",
      disconnectedMs: 0,
      reuploads: [
        {
          monsterKey: "wolf",
          monsterName: "Wolf",
          assetName: wolfName,
          uploaded: true,
        },
      ],
    });
    expect(player.reuploads).toBeUndefined();
  });
});

describe("describeError", () => {
  it("handles Errors, SDK-style objects, strings and anything else", () => {
    expect(describeError(new Error("bad"))).toBe("bad");
    expect(
      describeError({ name: "MissingDataError", message: "No scene found" }),
    ).toBe("MissingDataError: No scene found");
    expect(describeError({ message: "only message" })).toBe("only message");
    expect(describeError("plain")).toBe("plain");
    expect(describeError(42)).toBe("42");
    expect(describeError({ foo: 1 })).toBe("[object Object]");
    expect(describeError(null)).toBe("null");
  });
});

describe("panelView note", () => {
  const connected: PanelInput = {
    role: "gm",
    socketState: "open",
    disconnectedMs: 0,
  };

  it("panelView shows editNote as note", () => {
    const v = panelView({ ...connected, editNote: "The store holds HP 10." });

    expect(v.kind).toBe("connected");
    expect(v.note).toBe("The store holds HP 10.");
    expect(v.error).toBeUndefined();
  });

  it("panelView has no note without editNote", () => {
    // Control: the same input with a note shows it.
    expect(panelView({ ...connected, editNote: "x" }).note).toBe("x");

    expect(panelView(connected).note).toBeUndefined();
    expect(panelView({ ...connected, editNote: "" }).note).toBeUndefined();
  });

  it("panelView shows no note for the gm-only and token-missing views", () => {
    // Control: a connected view shows the note.
    expect(panelView({ ...connected, editNote: "x" }).note).toBe("x");

    const player = panelView({ ...connected, role: "player", editNote: "x" });
    expect(player.kind).toBe("gm-only");
    expect(player.note).toBeUndefined();

    const noToken = panelView({
      ...connected,
      tokenMissing: true,
      editNote: "x",
    });
    expect(noToken.kind).toBe("token-missing");
    expect(noToken.note).toBeUndefined();
  });
});

describe("panelView waiting edits and overrides", () => {
  const connected: PanelInput = {
    role: "gm",
    socketState: "open",
    disconnectedMs: 0,
  };

  it("the note line says how many table edits are waiting", () => {
    const waiting = panelView({ ...connected, waitingCommands: 3 });
    expect(waiting.note ?? "").toMatch(/3/);
    expect(waiting.note ?? "").toMatch(/waiting/);

    // Alongside the clamp note, not instead of it.
    const both = panelView({
      ...connected,
      waitingCommands: 3,
      editNote: "The store holds HP 10.",
    });
    expect(both.note ?? "").toContain("The store holds HP 10.");
    expect(both.note ?? "").toMatch(/3/);

    // Control: nothing waiting, no mention.
    expect(
      panelView({ ...connected, waitingCommands: 0 }).note,
    ).toBeUndefined();
  });

  it("the override records render in the panel view, and an empty list renders none", () => {
    const records = [
      "After connecting, the store set Goblin 2 HP to 16; the table showed 99.",
      "After connecting, the store set Goblin 3 armor class to 15; the table showed 3.",
    ];

    expect(panelView({ ...connected, overrides: records }).overrides).toEqual(
      records,
    );
    expect(
      panelView({ ...connected, overrides: [] }).overrides,
    ).toBeUndefined();
    expect(panelView(connected).overrides).toBeUndefined();
  });
});

describe("panelView token art", () => {
  const connected: PanelInput = {
    role: "gm",
    socketState: "open",
    disconnectedMs: 0,
  };

  it("each monster type in the Token art list is a row with its name and art state, and an empty list renders no rows", () => {
    const view = panelView({
      ...connected,
      typeArt: [
        { monsterKey: "wolf", monsterName: "Wolf", state: "art" },
        { monsterKey: "goblin", monsterName: "Goblin", state: "none" },
        { monsterKey: "orc", monsterName: "Orc", state: "declined" },
        { monsterKey: "shadow", monsterName: "Shadow", state: "reupload" },
      ],
    });

    expect(view.typeArt).toEqual([
      { monsterKey: "wolf", label: "Wolf: has token art", canPick: false },
      {
        monsterKey: "goblin",
        label: "Goblin: no token art yet",
        canPick: false,
      },
      {
        monsterKey: "orc",
        label: "Orc: circles, no art picked",
        canPick: false,
      },
      {
        monsterKey: "shadow",
        label: "Shadow: circles until its art is re-uploaded (above)",
        canPick: false,
      },
    ]);

    const empty = panelView({ ...connected, typeArt: [] });
    expect(empty).not.toHaveProperty("typeArt");
    expect(panelView(connected)).not.toHaveProperty("typeArt");
  });

  it("a Token art row with an uploaded asset name tells the GM to confirm the folder and pick the named image, and offers the pick of the uploaded image; a row without one offers neither", () => {
    const view = panelView({
      ...connected,
      typeArt: [
        {
          monsterKey: "orc",
          monsterName: "Orc",
          state: "declined",
          uploadedAs: "ttrpg-art-ba7816bf8f01cfea",
        },
        { monsterKey: "wolf", monsterName: "Wolf", state: "art" },
      ],
    });

    expect(view.typeArt).toEqual([
      {
        monsterKey: "orc",
        label: "Orc: circles, no art picked",
        hint: `Confirm the folder in Owlbear's upload dialog, then press "Pick the uploaded image" and pick ttrpg-art-ba7816bf8f01cfea.`,
        canPick: true,
      },
      { monsterKey: "wolf", label: "Wolf: has token art", canPick: false },
    ]);
    expect(view.typeArt?.[1]).not.toHaveProperty("hint");
  });
});
