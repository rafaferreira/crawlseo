/**
 * Collapses Bing's daily crawl rows into one summary.
 *
 * The API mixes two grains in one response and only one of them may be summed.
 * `crawledPages` counts what bingbot fetched that day. Every status field is a
 * running snapshot of how many URLs Bing currently knows in that state -
 * measured on a 29-page site, `code2xx` read ~4,238 on every single day of a
 * 27-day window. Summing those multiplies the truth by the day count, which is
 * how a 29-page site reported 114,247 pages returning 2xx.
 */
export interface CrawlDayRow {
  date: Date;
  crawledPages: number | null;
  inIndex: number | null;
  inLinks: number | null;
  code2xx: number | null;
  code301: number | null;
  code302: number | null;
  code4xx: number | null;
  code5xx: number | null;
  blockedByRobots: number | null;
  crawlErrors: number | null;
}

export function summariseCrawlRows(rows: CrawlDayRow[]) {
  if (rows.length === 0) return null;

  const first = rows[0];
  const latest = rows[rows.length - 1];
  const moved = (pick: (row: CrawlDayRow) => number | null) =>
    (pick(latest) ?? 0) - (pick(first) ?? 0);

  return {
    firstDate: first.date.toISOString().slice(0, 10),
    latestDate: latest.date.toISOString().slice(0, 10),
    days: rows.length,
    /** Summed: this one really is a daily count. */
    crawledPages: rows.reduce((total, row) => total + (row.crawledPages ?? 0), 0),
    /** Latest snapshot of URLs Bing knows in each state. */
    inIndex: latest.inIndex ?? 0,
    inLinks: latest.inLinks ?? 0,
    code2xx: latest.code2xx ?? 0,
    code301: latest.code301 ?? 0,
    code302: latest.code302 ?? 0,
    code4xx: latest.code4xx ?? 0,
    code5xx: latest.code5xx ?? 0,
    blockedByRobots: latest.blockedByRobots ?? 0,
    crawlErrors: latest.crawlErrors ?? 0,
    changes: {
      inIndex: moved((row) => row.inIndex),
      code301: moved((row) => row.code301),
      code4xx: moved((row) => row.code4xx),
      code5xx: moved((row) => row.code5xx),
    },
  };
}
