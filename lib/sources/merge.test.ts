import { describe, it, expect } from "vitest";
import { mergeSourceRows } from "./merge";
import { normaliseQueryKey, normaliseUrlKey } from "@/lib/bing/bing-read";

describe("mergeSourceRows", () => {
  it("adds volume and weights position by impressions across sources", () => {
    const [row] = mergeSourceRows([
      [{ key: "laudo", label: "laudo", clicks: 2, impressions: 100, position: 50 }],
      [{ key: "laudo", label: "LAUDO", clicks: 1, impressions: 100, position: 2 }],
    ]);

    expect(row.clicks).toBe(3);
    expect(row.impressions).toBe(200);
    expect(row.position).toBe(26); // (50*100 + 2*100) / 200
    expect(row.ctr).toBeCloseTo(0.015);
  });

  it("recomputes CTR from totals instead of averaging the two rates", () => {
    const [row] = mergeSourceRows([
      [{ key: "q", label: "q", clicks: 1, impressions: 1, position: 1 }],
      [{ key: "q", label: "q", clicks: 0, impressions: 999, position: 40 }],
    ]);

    // Averaging the rates would give ~50%; the honest number is 1 in 1000.
    expect(row.ctr).toBeCloseTo(0.001);
  });

  it("keeps the first source's label for a shared key", () => {
    const [row] = mergeSourceRows([
      [{ key: "q", label: "Search Console spelling", clicks: 0, impressions: 5, position: 3 }],
      [{ key: "q", label: "bing spelling", clicks: 0, impressions: 5, position: 3 }],
    ]);

    expect(row.label).toBe("Search Console spelling");
  });

  it("ignores a missing position instead of counting it as rank zero", () => {
    const [row] = mergeSourceRows([
      [{ key: "q", label: "q", clicks: 0, impressions: 10, position: 8 }],
      [{ key: "q", label: "q", clicks: 0, impressions: 90, position: null }],
    ]);

    expect(row.position).toBe(8);
    expect(row.impressions).toBe(100);
  });

  it("reports no position when no source could supply one", () => {
    const [row] = mergeSourceRows([
      [{ key: "q", label: "q", clicks: 0, impressions: 4, position: null }],
    ]);

    expect(row.position).toBe(0);
  });

  it("sorts by clicks, then impressions", () => {
    const rows = mergeSourceRows([
      [
        { key: "a", label: "a", clicks: 1, impressions: 1, position: 1 },
        { key: "b", label: "b", clicks: 5, impressions: 1, position: 1 },
        { key: "c", label: "c", clicks: 1, impressions: 9, position: 1 },
      ],
    ]);

    expect(rows.map((row) => row.label)).toEqual(["b", "c", "a"]);
  });
});

describe("cross-source keys", () => {
  it("matches the same page across differing property URL forms", () => {
    // Measured: Bing knows periciatecnica.eng.br, Search Console knows www.
    expect(normaliseUrlKey("https://www.periciatecnica.eng.br/servicos/")).toBe(
      normaliseUrlKey("https://periciatecnica.eng.br/servicos")
    );
  });

  it("matches queries regardless of case and padding", () => {
    expect(normaliseQueryKey("  Laudo Técnico ")).toBe(
      normaliseQueryKey("laudo técnico")
    );
  });

  it("keeps genuinely different paths apart", () => {
    expect(normaliseUrlKey("https://a.com/one")).not.toBe(
      normaliseUrlKey("https://a.com/two")
    );
  });
});
