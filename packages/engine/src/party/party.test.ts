import { describe, expect, it } from "vitest";
import { InvalidPartyError } from "./errors.js";
import {
  resolveParty,
  setParty,
  type Party,
  type PartyStore,
} from "./party.js";

function fakeStore(initial: Party | null): PartyStore & { sets: Party[] } {
  let stored = initial;
  const sets: Party[] = [];
  return {
    sets,
    get: () => stored,
    set: (party) => {
      sets.push(party);
      stored = party;
    },
  };
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

function expectInvalidParty(err: unknown, message: string): void {
  expect(err).toBeInstanceOf(InvalidPartyError);
  expect((err as InvalidPartyError).code).toBe("invalid_party");
  expect((err as InvalidPartyError).message).toBe(message);
}

describe("setParty", () => {
  it.each<[string, Partial<Party>, string]>([
    ["only a size", { size: 4 }, "Party level is not set."],
    ["only a level", { level: 5 }, "Party size is not set."],
    ["neither", {}, "Party size and level are not set."],
  ])(
    "setParty with nothing stored fails naming each missing number and stores nothing (%s)",
    (_label, change, message) => {
      const store = fakeStore(null);
      expectInvalidParty(
        caught(() => setParty(store, change)),
        message,
      );
      expect(store.sets).toEqual([]);
    },
  );

  it("setParty with nothing stored and both numbers stores them and returns no previous party", () => {
    const store = fakeStore(null);
    const change = setParty(store, { size: 4, level: 5 });
    expect(change).toEqual({ before: null, after: { size: 4, level: 5 } });
    expect(store.sets).toEqual([{ size: 4, level: 5 }]);
    expect(store.get()).toEqual({ size: 4, level: 5 });
  });

  it("setParty with a party stored and only a level keeps the size, stores the new level and returns the previous and new party", () => {
    const store = fakeStore({ size: 4, level: 5 });
    const change = setParty(store, { level: 7 });
    expect(change).toEqual({
      before: { size: 4, level: 5 },
      after: { size: 4, level: 7 },
    });
    expect(store.sets).toEqual([{ size: 4, level: 7 }]);
  });

  it.each<[string, Partial<Party>, string]>([
    [
      "size 0",
      { size: 0, level: 5 },
      "Party size must be a whole number of 1 or more; got 0.",
    ],
    [
      "size 2.5",
      { size: 2.5, level: 5 },
      "Party size must be a whole number of 1 or more; got 2.5.",
    ],
    [
      "level 0",
      { size: 4, level: 0 },
      "Party level must be a whole number from 1 to 20; got 0.",
    ],
    [
      "level 21",
      { size: 4, level: 21 },
      "Party level must be a whole number from 1 to 20; got 21.",
    ],
    [
      "level 4.5",
      { size: 4, level: 4.5 },
      "Party level must be a whole number from 1 to 20; got 4.5.",
    ],
  ])(
    "setParty rejects a size that is not a whole number of 1 or more and a level that is not a whole number from 1 to 20, and stores nothing (%s)",
    (_label, change, message) => {
      const store = fakeStore({ size: 3, level: 2 });
      expectInvalidParty(
        caught(() => setParty(store, change)),
        message,
      );
      expect(store.sets).toEqual([]);
    },
  );
});

describe("resolveParty", () => {
  const stored: Party = { size: 4, level: 5 };

  it.each<[string, Partial<Party>, Party]>([
    ["both overridden", { size: 6, level: 9 }, { size: 6, level: 9 }],
    ["size only", { size: 6 }, { size: 6, level: 5 }],
    ["level only", { level: 9 }, { size: 4, level: 9 }],
    ["neither", {}, { size: 4, level: 5 }],
  ])(
    "resolveParty takes each number from the override when given and from the stored party otherwise (%s)",
    (_label, override, expected) => {
      expect(resolveParty(stored, override)).toEqual(expected);
    },
  );

  it.each<[string, Partial<Party>, string]>([
    ["no override", {}, "Party size and level are not set."],
    ["a size", { size: 4 }, "Party level is not set."],
    ["a level", { level: 5 }, "Party size is not set."],
  ])(
    "resolveParty names every missing number (nothing stored and %s)",
    (_label, override, message) => {
      expectInvalidParty(
        caught(() => resolveParty(null, override)),
        message,
      );
    },
  );

  it.each<[string, Partial<Party>, string]>([
    [
      "size 0",
      { size: 0 },
      "Party size must be a whole number of 1 or more; got 0.",
    ],
    [
      "size 1.5",
      { size: 1.5 },
      "Party size must be a whole number of 1 or more; got 1.5.",
    ],
    [
      "level 0",
      { level: 0 },
      "Party level must be a whole number from 1 to 20; got 0.",
    ],
    [
      "level 21",
      { level: 21 },
      "Party level must be a whole number from 1 to 20; got 21.",
    ],
  ])(
    "resolveParty rejects an override size that is not a whole number of 1 or more or a level that is not a whole number from 1 to 20 (%s)",
    (_label, override, message) => {
      expectInvalidParty(
        caught(() => resolveParty(stored, override)),
        message,
      );
    },
  );
});
