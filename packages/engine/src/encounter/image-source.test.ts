import { describe, expect, it } from "vitest";
import { InvalidTokenRequestError } from "./errors.js";
import { parseImageLocation } from "./image-source.js";

describe("parseImageLocation", () => {
  it("parseImageLocation reads an https URL as a url and an absolute path as a path", () => {
    expect(parseImageLocation("https://example.com/art/owlbear.png")).toEqual({
      url: "https://example.com/art/owlbear.png",
    });
    expect(parseImageLocation("/home/dm/art/owlbear.png")).toEqual({
      path: "/home/dm/art/owlbear.png",
    });
  });

  it.each([
    ["an http URL", "http://example.com/art/owlbear.png"],
    ["a relative path", "art/owlbear.png"],
    ["a file URL", "file:///home/dm/art/owlbear.png"],
    ["an empty string", ""],
  ])(
    "parseImageLocation refuses %s with an InvalidTokenRequestError",
    (_case, image) => {
      expect(() => parseImageLocation(image)).toThrow(InvalidTokenRequestError);
    },
  );
});
