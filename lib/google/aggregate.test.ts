import { describe, it, expect } from "vitest";
import { aggregateByQueryAndDate } from "./aggregate";

const base = { date: "2026-08-20", ctr: 0, page: "https://a.com/x" };

describe("aggregateByQueryAndDate", () => {
  it("adds up the device and country slices of one query-day", () => {
    const [row] = aggregateByQueryAndDate([
      { ...base, query: "laudo", device: "MOBILE", country: "bra", clicks: 3, impressions: 30, position: 4 },
      { ...base, query: "laudo", device: "DESKTOP", country: "bra", clicks: 2, impressions: 10, position: 8 },
    ]);

    // Storing these unmerged would key both on (site, laudo, 2026-08-20) and
    // let the second overwrite the first, losing three clicks.
    expect(row.clicks).toBe(5);
    expect(row.impressions).toBe(40);
    expect(row.position).toBe(5); // (4*30 + 8*10) / 40
    expect(row.ctr).toBeCloseTo(0.125);
  });

  it("keeps different days and different queries apart", () => {
    const rows = aggregateByQueryAndDate([
      { ...base, query: "laudo", clicks: 1, impressions: 1, position: 1 },
      { ...base, query: "laudo", date: "2026-08-21", clicks: 1, impressions: 1, position: 1 },
      { ...base, query: "perito", clicks: 1, impressions: 1, position: 1 },
    ]);

    expect(rows).toHaveLength(3);
  });

  it("keeps the landing page that carried the most impressions", () => {
    const [row] = aggregateByQueryAndDate([
      { ...base, query: "laudo", page: "https://a.com/small", clicks: 0, impressions: 2, position: 9 },
      { ...base, query: "laudo", page: "https://a.com/big", clicks: 0, impressions: 40, position: 3 },
    ]);

    expect(row.page).toBe("https://a.com/big");
  });

  it("only claims a device or country when the day had just one", () => {
    const [mixed] = aggregateByQueryAndDate([
      { ...base, query: "q", device: "MOBILE", country: "bra", clicks: 0, impressions: 1, position: 5 },
      { ...base, query: "q", device: "DESKTOP", country: "bra", clicks: 0, impressions: 1, position: 5 },
    ]);
    expect(mixed.device).toBeUndefined();
    expect(mixed.country).toBe("bra");
  });

  it("does not divide by zero when a slice had no impressions", () => {
    const [row] = aggregateByQueryAndDate([
      { ...base, query: "q", clicks: 0, impressions: 0, position: 12 },
    ]);
    expect(row.position).toBe(12);
    expect(row.ctr).toBe(0);
  });
});
