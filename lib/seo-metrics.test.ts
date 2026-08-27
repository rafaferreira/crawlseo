import { describe, it, expect } from "vitest";
import { parseRange } from "./seo-metrics";

const DAY = 24 * 60 * 60 * 1000;
/** Whole days a window covers, counting both endpoints. */
const spanInDays = (r: { start: Date; end: Date }) =>
  Math.round((r.end.getTime() - r.start.getTime()) / DAY);

describe("parseRange", () => {
  it("covers exactly the number of days asked for", () => {
    // A 29-day span holds five Fridays whenever it starts on one, which moved
    // every weekly-bucket total by a quarter one day in seven.
    for (const days of [1, 7, 28, 90, 365]) {
      expect(spanInDays(parseRange(days))).toBe(days);
    }
  });

  it("starts at midnight UTC and ends at the last millisecond of the day", () => {
    const { start, end } = parseRange(28);
    expect(start.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(end.toISOString()).toMatch(/T23:59:59\.999Z$/);
  });

  it("never inverts the window, whatever it is handed", () => {
    // An inverted window matches no rows, and an empty result reads exactly
    // like "this site has no data".
    for (const days of [0, -5, 0.4, NaN]) {
      const range = parseRange(days);
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    }
  });

  it("contains the same number of weekdays for a given length", () => {
    const fridays = (r: { start: Date; end: Date }) => {
      let count = 0;
      for (let t = r.start.getTime(); t <= r.end.getTime(); t += DAY) {
        if (new Date(t).getUTCDay() === 5) count++;
      }
      return count;
    };
    expect(fridays(parseRange(28))).toBe(4);
  });
});
