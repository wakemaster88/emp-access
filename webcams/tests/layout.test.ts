import { describe, expect, it } from "vitest";
import { packFlow } from "@/lib/layout";

describe("packFlow", () => {
  it("zieht ein schmales Tile in die Lücke vor einem Duo-3", () => {
    const packed = packFlow(
      ["a", "b", "c", "d", "wide", "tail"],
      (id) => (id === "wide" ? 2 : 1),
      5,
    );
    expect(packed.map((p) => p.item)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "tail",
      "wide",
    ]);
    const byId = Object.fromEntries(packed.map((p) => [p.item, p]));
    expect(byId.tail.row).toBe(0);
    expect(byId.tail.col).toBe(4);
    expect(byId.wide.row).toBe(1);
    expect(byId.wide.col).toBe(0);
  });

  it("lässt die Reihenfolge, wenn alles passt", () => {
    const packed = packFlow(
      ["a", "b", "c", "d"],
      () => 1,
      2,
    );
    expect(packed.map((p) => p.item)).toEqual(["a", "b", "c", "d"]);
  });
});
