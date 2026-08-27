import { describe, it, expect } from "vitest";
import { summariseCrawlRows, type CrawlDayRow } from "./crawl-summary";

function day(date: string, over: Partial<CrawlDayRow> = {}): CrawlDayRow {
  return {
    date: new Date(`${date}T00:00:00.000Z`),
    crawledPages: 0,
    inIndex: 0,
    inLinks: 0,
    code2xx: 0,
    code301: 0,
    code302: 0,
    code4xx: 0,
    code5xx: 0,
    blockedByRobots: 0,
    crawlErrors: 0,
    ...over,
  };
}

describe("summariseCrawlRows", () => {
  // Measured on a 29-page site: code2xx read ~4,238 every single day. Summing
  // it reported 114,247 pages returning 2xx.
  it("sums the daily count but never the running snapshots", () => {
    const summary = summariseCrawlRows([
      day("2026-08-01", { crawledPages: 100, code2xx: 4238, inIndex: 200 }),
      day("2026-08-02", { crawledPages: 120, code2xx: 4239, inIndex: 205 }),
      day("2026-08-03", { crawledPages: 131, code2xx: 4234, inIndex: 207 }),
    ])!;

    expect(summary.crawledPages).toBe(351);
    expect(summary.code2xx).toBe(4234);
    expect(summary.inIndex).toBe(207);
  });

  it("reports how far a snapshot moved across the window", () => {
    const summary = summariseCrawlRows([
      day("2026-07-30", { crawledPages: 1, code301: 369, code5xx: 158 }),
      day("2026-08-26", { crawledPages: 1, code301: 309, code5xx: 14 }),
    ])!;

    expect(summary.changes.code301).toBe(-60);
    expect(summary.changes.code5xx).toBe(-144);
    expect(summary.days).toBe(2);
    expect(summary.firstDate).toBe("2026-07-30");
    expect(summary.latestDate).toBe("2026-08-26");
  });

  it("treats a missing counter as zero rather than NaN", () => {
    const summary = summariseCrawlRows([
      day("2026-08-01", { crawledPages: null, code301: null }),
      day("2026-08-02", { crawledPages: 5, code301: 3 }),
    ])!;

    expect(summary.crawledPages).toBe(5);
    expect(summary.changes.code301).toBe(3);
  });

  it("has nothing to say about an empty window", () => {
    expect(summariseCrawlRows([])).toBeNull();
  });
});
