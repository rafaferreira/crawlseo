import { db } from "@/lib/db";
import { calculatePercentChange, getDateRange } from "@/lib/date-utils";
import { collapseWeeks } from "@/lib/bing/bing-parse";
import { getTopKeywords } from "@/lib/seo-metrics";

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

function parseRange(days: number) {
  const { start, end } = getDateRange(days);
  return {
    start: new Date(`${start}T00:00:00.000Z`),
    end: new Date(`${end}T23:59:59.999Z`),
  };
}

function previousRange(days: number) {
  const current = parseRange(days);
  const start = new Date(current.start);
  start.setUTCDate(start.getUTCDate() - days);
  const end = new Date(current.start);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

function normaliseQuery(query: string): string {
  return query.trim().toLowerCase();
}

function totals(
  rows: Array<{ clicks: number | null; impressions: number | null }>
): BingPeriodMetrics {
  const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
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
    db.bingDaily.findMany({
      where: { siteId, date: { gte: currentRange.start, lte: currentRange.end } },
      select: { clicks: true, impressions: true },
    }),
    db.bingDaily.findMany({
      where: { siteId, date: { gte: prevRange.start, lte: prevRange.end } },
      select: { clicks: true, impressions: true },
    }),
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

export async function getBingDailyTraffic(
  siteId: string,
  days = 90
): Promise<Array<{ date: string; clicks: number; impressions: number }>> {
  const range = parseRange(days);
  const rows = await db.bingDaily.findMany({
    where: { siteId, date: { gte: range.start, lte: range.end } },
    select: { date: true, clicks: true, impressions: true },
    orderBy: { date: "asc" },
  });

  return rows
    .filter((row) => row.clicks !== null || row.impressions !== null)
    .map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
    }));
}

/**
 * Weekly buckets whose week-ending date falls inside the window, collapsed per
 * key. The edges are approximate by up to six days: Bing offers no finer grain.
 */
export async function getBingTopRows(
  siteId: string,
  kind: "query" | "page",
  days = 28,
  limit = 50
): Promise<BingRow[]> {
  const range = parseRange(days);
  const rows = await db.bingSearchWeekly.findMany({
    where: { siteId, kind, weekEnding: { gte: range.start, lte: range.end } },
    select: {
      key: true,
      weekEnding: true,
      clicks: true,
      impressions: true,
      avgImpressionPosition: true,
      avgClickPosition: true,
    },
  });

  return collapseWeeks(
    rows.map((row) => ({
      key: row.key,
      weekEnding: row.weekEnding.toISOString().slice(0, 10),
      clicks: row.clicks,
      impressions: row.impressions,
      avgImpressionPosition: row.avgImpressionPosition,
      avgClickPosition: row.avgClickPosition,
    }))
  ).slice(0, limit);
}

/** Bing's crawler stats. Search Console exposes no equivalent through its API. */
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

  if (rows.length === 0) return null;

  const latest = rows[rows.length - 1];
  const sum = (pick: (row: (typeof rows)[number]) => number | null) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

  return {
    latestDate: latest.date.toISOString().slice(0, 10),
    inIndex: latest.inIndex ?? 0,
    inLinks: latest.inLinks ?? 0,
    crawledPages: sum((row) => row.crawledPages),
    code2xx: sum((row) => row.code2xx),
    code301: sum((row) => row.code301),
    code302: sum((row) => row.code302),
    code4xx: sum((row) => row.code4xx),
    code5xx: sum((row) => row.code5xx),
    blockedByRobots: sum((row) => row.blockedByRobots),
    crawlErrors: sum((row) => row.crawlErrors),
    days: rows.length,
  };
}

/**
 * Queries each engine reports for this site, side by side.
 *
 * Volume is never added up: the grains differ and Search Console drops
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

  const [googleRows, bingWeeks] = await Promise.all([
    getTopKeywords(siteId, days, 5000),
    db.bingSearchWeekly.findMany({
      where: {
        siteId,
        kind: "query",
        weekEnding: { gte: range.start, lte: range.end },
      },
      select: {
        key: true,
        weekEnding: true,
        clicks: true,
        impressions: true,
        avgImpressionPosition: true,
        avgClickPosition: true,
      },
    }),
  ]);

  const bing = new Map<string, BingRow>();
  for (const row of collapseWeeks(
    bingWeeks.map((row) => ({
      key: row.key,
      weekEnding: row.weekEnding.toISOString().slice(0, 10),
      clicks: row.clicks,
      impressions: row.impressions,
      avgImpressionPosition: row.avgImpressionPosition,
      avgClickPosition: row.avgClickPosition,
    }))
  )) {
    bing.set(normaliseQuery(row.key), row);
  }

  const rows: EngineRow[] = [];
  const counts = { both: 0, google: 0, bing: 0 };

  for (const google of googleRows) {
    const key = normaliseQuery(google.query);
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
