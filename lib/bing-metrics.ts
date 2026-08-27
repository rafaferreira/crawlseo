import { db } from "@/lib/db";
import { calculatePercentChange } from "@/lib/date-utils";
import {
  getBingDailyRows,
  getBingWindowRows,
} from "@/lib/bing/bing-read";
import { summariseCrawlRows } from "@/lib/bing/crawl-summary";
import {
  normaliseQueryKey,
} from "@/lib/sources/keys";
import { getTopKeywords, parseRange, previousRange } from "@/lib/seo-metrics";

/**
 * Bing-only reads, for the Bing vs Google page.
 *
 * Everywhere else the two engines arrive already combined through
 * lib/seo-metrics; this module is what keeps a per-engine view possible.
 */

export type BingPeriodMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
};

export type BingRow = {
  key: string;
  clicks: number;
  impressions: number;
  position: number | null;
  ctr: number;
};

export type EngineRow = {
  query: string;
  presence: "both" | "google" | "bing";
  googleClicks: number;
  googleImpressions: number;
  googlePosition: number | null;
  bingClicks: number;
  bingImpressions: number;
  bingPosition: number | null;
  /** Google position minus Bing position; positive means Bing ranks better. */
  gap: number | null;
};

function totals(
  rows: Array<{ clicks: number; impressions: number }>
): BingPeriodMetrics {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0 };
}

/** Bing's traffic rows are daily, so a day-based window needs no approximation. */
export async function getBingPeriodMetrics(
  siteId: string,
  days = 28
): Promise<{
  current: BingPeriodMetrics;
  previous: BingPeriodMetrics;
  deltas: { clicks: number; impressions: number; ctr: number };
}> {
  const currentRange = parseRange(days);
  const prevRange = previousRange(days);

  const [currentRows, previousRows] = await Promise.all([
    getBingDailyRows(siteId, currentRange.start, currentRange.end),
    getBingDailyRows(siteId, prevRange.start, prevRange.end),
  ]);

  const current = totals(currentRows);
  const previous = totals(previousRows);

  return {
    current,
    previous,
    deltas: {
      clicks: calculatePercentChange(current.clicks, previous.clicks),
      impressions: calculatePercentChange(
        current.impressions,
        previous.impressions
      ),
      ctr: calculatePercentChange(current.ctr, previous.ctr),
    },
  };
}


export async function getBingTopRows(
  siteId: string,
  kind: "query" | "page",
  days = 28,
  limit = 50
): Promise<BingRow[]> {
  const range = parseRange(days);
  const rows = await getBingWindowRows(siteId, kind, range.start, range.end);
  return rows.slice(0, limit);
}

/**
 * Bing's crawler stats. Search Console exposes no equivalent through its API.
 *
 * Only `crawledPages` is a per-day count. Every status field is a running
 * snapshot of the URLs Bing knows in that state: measured on a 29-page site,
 * code2xx sat at ~4,238 on every single day of the window. Adding those up
 * would multiply the truth by the number of days, so the snapshot fields
 * report their latest value plus how much they moved across the window.
 */
export async function getBingCrawlSummary(siteId: string, days = 28) {
  const range = parseRange(days);
  const rows = await db.bingDaily.findMany({
    where: {
      siteId,
      date: { gte: range.start, lte: range.end },
      crawledPages: { not: null },
    },
    orderBy: { date: "asc" },
  });

  return summariseCrawlRows(rows);
}

/**
 * Queries each engine reports for this site, side by side.
 *
 * Volume is never added up here: the grains differ and Search Console drops
 * anonymised queries entirely. What survives comparison is which engine sees a
 * query at all, and where each one ranks it.
 */
export async function getEngineComparison(
  siteId: string,
  days = 90
): Promise<{
  rows: EngineRow[];
  counts: { both: number; google: number; bing: number };
}> {
  const range = parseRange(days);

  const [googleRows, bingRows] = await Promise.all([
    getTopKeywords(siteId, days, 5000, ["google"]),
    getBingWindowRows(siteId, "query", range.start, range.end),
  ]);

  const bing = new Map(bingRows.map((row) => [normaliseQueryKey(row.key), row]));

  const rows: EngineRow[] = [];
  const counts = { both: 0, google: 0, bing: 0 };

  for (const google of googleRows) {
    const key = normaliseQueryKey(google.query);
    const match = bing.get(key);
    if (match) bing.delete(key);

    const presence = match ? "both" : "google";
    counts[presence]++;

    rows.push({
      query: google.query,
      presence,
      googleClicks: google.clicks,
      googleImpressions: google.impressions,
      googlePosition: google.position > 0 ? google.position : null,
      bingClicks: match?.clicks ?? 0,
      bingImpressions: match?.impressions ?? 0,
      bingPosition: match?.position ?? null,
      gap:
        match?.position != null && google.position > 0
          ? Number((google.position - match.position).toFixed(1))
          : null,
    });
  }

  for (const [, row] of bing) {
    counts.bing++;
    rows.push({
      query: row.key,
      presence: "bing",
      googleClicks: 0,
      googleImpressions: 0,
      googlePosition: null,
      bingClicks: row.clicks,
      bingImpressions: row.impressions,
      bingPosition: row.position,
      gap: null,
    });
  }

  rows.sort(
    (a, b) =>
      b.googleImpressions + b.bingImpressions -
      (a.googleImpressions + a.bingImpressions)
  );

  return { rows, counts };
}
