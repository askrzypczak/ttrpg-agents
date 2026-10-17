import { expect, it } from "vitest";

it("throwaway: fails on purpose to prove CI goes red", () => {
  expect(1).toBe(2);
});
