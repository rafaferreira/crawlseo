/**
 * Pure parsing helpers for the Bing Webmaster Tools JSON API.
 * Kept free of database imports so they can be unit tested on their own.
 */

/**
 * One weekly bucket for a query or a page. Bing reports both through the same
 * QueryStats contract - for GetPageStats the URL arrives in the `Query` field.
 */
export interface BingSearchWeek {
  key: string;
  weekEnding: string; // YYYY-MM-DD (a Friday)
  clicks: number;
  impressions: number;
  avgImpressionPosition: number | null;
  avgClickPosition: number | null;
}

export interface RawQueryStats {
  Query: string;
  Date: string;
  Clicks: number;
  Impressions: number;
  AvgImpressionPosition?: number;
  AvgClickPosition?: number;
}

/**
 * Bing serialises dates as .NET strings: `/Date(1747983600000-0700)/`.
 * The epoch is midnight in Bing's own (Pacific) timezone, so the UTC calendar
 * date of that instant is the day Bing means - 00:00 PT is 07:00/08:00 UTC,
 * still the same day. Formatting in server-local time would slide it.
 */
export function parseBingDate(value: string): string {
  const match = /\/Date\((-?\d+)/.exec(value);
  if (!match) throw new Error(`Unparseable Bing date: ${value}`);
  return new Date(Number(match[1])).toISOString().slice(0, 10);
}

/**
 * Bing sends -1 for AvgClickPosition when the row had no clicks at all.
 * That is a sentinel, not a position - averaging it produces negative ranks.
 */
export function normalisePosition(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * Collapses raw rows to one record per (key, week), summing volume and
 * weighting positions by impressions. Bing can repeat a key inside a bucket;
 * writing rows straight through would let the last one overwrite the rest.
 */
export function aggregateWeekly(rows: RawQueryStats[]): BingSearchWeek[] {
  const byKey = new Map<
    string,
    BingSearchWeek & { impWeight: number; clickWeight: number }
  >();

  for (const row of rows) {
    if (!row?.Query || !row?.Date) continue;
    const weekEnding = parseBingDate(row.Date);
    const id = `${row.Query} ${weekEnding}`;
    const clicks = row.Clicks ?? 0;
    const impressions = row.Impressions ?? 0;
    const impPos = normalisePosition(row.AvgImpressionPosition);
    const clickPos = normalisePosition(row.AvgClickPosition);

    const entry = byKey.get(id) ?? {
      key: row.Query,
      weekEnding,
      clicks: 0,
      impressions: 0,
      avgImpressionPosition: null,
      avgClickPosition: null,
      impWeight: 0,
      clickWeight: 0,
    };

    entry.clicks += clicks;
    entry.impressions += impressions;
    if (impPos !== null) {
      const weight = Math.max(impressions, 1);
      entry.avgImpressionPosition =
        (entry.avgImpressionPosition ?? 0) + impPos * weight;
      entry.impWeight += weight;
    }
    if (clickPos !== null) {
      const weight = Math.max(clicks, 1);
      entry.avgClickPosition = (entry.avgClickPosition ?? 0) + clickPos * weight;
      entry.clickWeight += weight;
    }

    byKey.set(id, entry);
  }

  return Array.from(byKey.values()).map((entry) => ({
    key: entry.key,
    weekEnding: entry.weekEnding,
    clicks: entry.clicks,
    impressions: entry.impressions,
    avgImpressionPosition:
      entry.avgImpressionPosition !== null && entry.impWeight > 0
        ? Number((entry.avgImpressionPosition / entry.impWeight).toFixed(2))
        : null,
    avgClickPosition:
      entry.avgClickPosition !== null && entry.clickWeight > 0
        ? Number((entry.avgClickPosition / entry.clickWeight).toFixed(2))
        : null,
  }));
}

/**
 * Weekly buckets that fall inside a day-based window, collapsed per key.
 * A bucket counts when its week-ending date is inside the window, so the
 * edges are approximate by up to six days - Bing offers no finer grain.
 */
export function collapseWeeks(
  rows: BingSearchWeek[]
): Array<{
  key: string;
  clicks: number;
  impressions: number;
  position: number | null;
  ctr: number;
}> {
  const byKey = new Map<
    string,
    { clicks: number; impressions: number; weighted: number; weight: number }
  >();

  for (const row of rows) {
    const entry = byKey.get(row.key) ?? {
      clicks: 0,
      impressions: 0,
      weighted: 0,
      weight: 0,
    };
    entry.clicks += row.clicks;
    entry.impressions += row.impressions;
    if (row.avgImpressionPosition !== null) {
      const weight = Math.max(row.impressions, 1);
      entry.weighted += row.avgImpressionPosition * weight;
      entry.weight += weight;
    }
    byKey.set(row.key, entry);
  }

  return Array.from(byKey.entries())
    .map(([key, entry]) => ({
      key,
      clicks: entry.clicks,
      impressions: entry.impressions,
      position:
        entry.weight > 0 ? Number((entry.weighted / entry.weight).toFixed(1)) : null,
      ctr: entry.impressions > 0 ? entry.clicks / entry.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}
