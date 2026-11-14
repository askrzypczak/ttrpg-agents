// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Panel, type PanelActions } from "./panel.js";
import type { PanelView } from "./panel-state.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Row = NonNullable<PanelView["typeArt"]>[number];

function row(monsterKey: string, label: string, canPick = true): Row {
  return { monsterKey, label, canPick };
}

function makeView(
  typeArt: Row[] = [row("goblin", "Goblin"), row("owlbear", "Owlbear")],
): PanelView {
  return {
    kind: "connected",
    message: "Connected to the bridge.",
    action: "use-this-tab",
    overrides: ["Goblin 1: hp 7 over 5"],
    reuploads: [
      { monsterKey: "wolf", label: "Wolf", hint: "Uploaded.", canPick: true },
    ],
    typeArt: typeArt.length > 0 ? typeArt : undefined,
  };
}

function makeActions(): PanelActions {
  return {
    useThisTab: vi.fn(),
    dismissOverrides: vi.fn(),
    reuploadArt: vi.fn(),
    pickUploadedArt: vi.fn(),
    repickArt: vi.fn(),
    uploadArtFile: vi.fn(),
    pickUploadedFile: vi.fn(),
    setOverlayEnabled: vi.fn(),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(view: PanelView | undefined, actions: PanelActions): void {
  act(() => {
    root.render(<Panel view={view} sceneReady actions={actions} />);
  });
}

function fileInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("#art-file");
  if (!input) throw new Error("no #art-file input");
  return input;
}

describe("Panel", () => {
  it("a re-render with an equal view keeps every button element", () => {
    const actions = makeActions();
    render(makeView(), actions);
    const before = [...container.querySelectorAll("button")];
    expect(before.length).toBeGreaterThan(0);
    expect(container.querySelector("#use-this-tab")).not.toBeNull();
    expect(
      container.querySelector(
        '#type-art-list button[data-action="upload-art"]',
      ),
    ).not.toBeNull();

    render(makeView(), actions);
    const after = [...container.querySelectorAll("button")];
    expect(after).toHaveLength(before.length);
    after.forEach((button, i) => {
      expect(button).toBe(before[i]);
    });
  });

  it("the file input stays the same element when the Token art list changes or empties", () => {
    const actions = makeActions();
    render(makeView(), actions);
    const input = fileInput();
    expect(input.type).toBe("file");
    expect(container.querySelector("#type-art")?.contains(input)).toBe(true);
    expect(container.querySelector("#type-art-list")?.contains(input)).toBe(
      false,
    );

    render(
      makeView([row("owlbear", "Owlbear"), row("kobold", "Kobold")]),
      actions,
    );
    expect(fileInput()).toBe(input);

    render(makeView([]), actions);
    expect(fileInput()).toBe(input);
    expect(container.contains(input)).toBe(true);
  });

  it("a file chosen after the Token art list changed is uploaded for the row that pressed Upload new art", () => {
    const actions = makeActions();
    render(makeView(), actions);
    const input = fileInput();
    const clickInput = vi.spyOn(input, "click").mockImplementation(() => {});

    const upload = container.querySelector<HTMLButtonElement>(
      'li[data-monster-key="owlbear"] button[data-action="upload-art"]',
    );
    expect(upload).not.toBeNull();
    act(() => upload?.click());
    expect(clickInput).toHaveBeenCalled();

    // The list changes while the file chooser is open.
    render(
      makeView([row("owlbear", "Owlbear"), row("kobold", "Kobold")]),
      actions,
    );

    const file = new File(["png"], "owlbear.png", { type: "image/png" });
    Object.defineProperty(fileInput(), "files", {
      configurable: true,
      value: [file],
    });
    act(() => {
      fileInput().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(actions.uploadArtFile).toHaveBeenCalledTimes(1);
    expect(actions.uploadArtFile).toHaveBeenCalledWith("owlbear", file);
  });

  it("the panel shows the view's encounter line", () => {
    const actions = makeActions();
    render({ ...makeView(), encounter: "Encounter: Crypt" }, actions);

    const line = container.querySelector("#encounter");
    expect(line?.textContent).toBe("Encounter: Crypt");
    // Above the scene line.
    const scene = container.querySelector("#scene");
    expect(scene).not.toBeNull();
    expect(
      line!.compareDocumentPosition(scene!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    render(makeView(), actions);
    expect(container.querySelector("#encounter")?.textContent ?? "").toBe("");
  });
});
