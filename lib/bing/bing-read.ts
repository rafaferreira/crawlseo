import { db } from "@/lib/db";
import { collapseWeeks, type BingSearchWeek } from "./bing-parse";

/**
 * Low-level reads of the stored Bing data.
 *
 * Kept apart from lib/bing-metrics so that lib/seo-metrics can merge Bing into
 * the shared helpers without the two modules importing each other.
 */

/** The Bing property a site is connected to, or null when it has none. */
export async function bingPropertyFor(siteId: string): Promise<string | null> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { bingSite: true },
  });
  return site?.bingSite ?? null;
}

async function getBingWeeklyRows(
  siteId: string,
  kind: "query" | "page",
  start: Date,
  end: Date
): Promise<BingSearchWeek[]> {
  const rows = await db.bingSearchWeekly.findMany({
    where: { siteId, kind, weekEnding: { gte: start, lte: end } },
    select: {
      key: true,
      weekEnding: true,
      clicks: true,
      impressions: true,
      avgImpressionPosition: true,
    },
  });

  return rows.map((row) => ({
    key: row.key,
    weekEnding: row.weekEnding.toISOString().slice(0, 10),
    clicks: row.clicks,
    impressions: row.impressions,
    avgImpressionPosition: row.avgImpressionPosition,
  }));
}

/**
 * Bing's weekly buckets collapsed into one row per key for the window.
 * A bucket counts when its week-ending date falls inside the window, so the
 * edges are approximate by up to six days - Bing offers no finer grain.
 */
export async function getBingWindowRows(
  siteId: string,
  kind: "query" | "page",
  start: Date,
  end: Date
) {
  return collapseWeeks(await getBingWeeklyRows(siteId, kind, start, end));
}

export async function getBingDailyRows(siteId: string, start: Date, end: Date) {
  const rows = await db.bingDaily.findMany({
    where: { siteId, date: { gte: start, lte: end } },
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

