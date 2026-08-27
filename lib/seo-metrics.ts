import { calculatePercentChange, getDateRange } from "@/lib/date-utils";
import { resolveSources, type DataSource, type SourceId } from "@/lib/sources";
import { mergeSourceRows } from "@/lib/sources/merge";

/**
 * Search metrics for a site, read through the source registry.
 *
 * Every configured source contributes to these numbers, so each screen covers
 * whatever is connected without knowing which sources exist. Pass `sources` to
 * narrow a screen to one of them; the per-source breakdown lives on the
 * comparison page.
 *
 * Rows from different sources are matched on a normalised key (lowercased
 * query, host-and-slash-insensitive URL). Volume adds up, positions are
 * averaged weighted by impressions the same way they already are across days,
 * and CTR is recomputed from the merged totals rather than averaged.
 */

export type PeriodMetrics = {
  clicks: number;
  impressions: number;
  avgPosition: number;
  avgCtr: number;
  uniqueKeywords: number;
};

export type KeywordRow = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

export type PageRow = {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

export type DailyTraffic = {
  date: string;
  clicks: number;
  impressions: number;
};

/**
 * A window of exactly `days` calendar days, ending today.
 *
 * The span has to be exact because weekly sources are counted by how many of
 * their bucket dates land inside it: a 29-day span holds four Fridays most of
 * the time and five when it starts on one, which moved every Bing total by a
 * quarter one day in seven.
 */
export function parseRange(days: number) {
  // A window shorter than a day has no meaning, and a negative one silently
  // inverts start and end: every query then matches nothing and the caller
  // gets an empty result that reads exactly like "this site has no data".
  const span = Number.isFinite(days) ? Math.max(1, Math.trunc(days)) : 1;
  const { end } = getDateRange(span);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (span - 1));
  startDate.setUTCHours(0, 0, 0, 0);
  return { start: startDate, end: endDate };
}

export function previousRange(days: number) {
  const current = parseRange(days);
  const start = new Date(current.start);
  start.setUTCDate(start.getUTCDate() - days);
  const end = new Date(current.start);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

/** Impression-weighted average position */
function weightedPosition(
  rows: { position: number; impressions: number }[]
): number {
  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    const w = Math.max(row.impressions, 0);
    weighted += row.position * w;
    weight += w;
  }
  if (weight === 0) {
    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + r.position, 0) / rows.length;
  }
  return weighted / weight;
}

function gather<T>(
  sources: DataSource[],
  read: (source: DataSource) => Promise<T[]>
): Promise<T[][]> {
  return Promise.all(sources.map(read));
}

// ---------------------------------------------------------------------------
// Window reads
// ---------------------------------------------------------------------------

export async function getKeywordRowsForRange(
  siteId: string,
  start: Date,
  end: Date,
  limit = Number.MAX_SAFE_INTEGER,
  sources?: SourceId[] | SourceId | null
): Promise<KeywordRow[]> {
  const active = await resolveSources(siteId, sources);
  const batches = await gather(active, (source) =>
    source.queryRows(siteId, start, end)
  );

  return mergeSourceRows(batches)
    .slice(0, limit)
    .map(({ label, ...rest }) => ({ query: label, ...rest }));
}

export async function getPageRowsForRange(
  siteId: string,
  start: Date,
  end: Date,
  limit = Number.MAX_SAFE_INTEGER,
  sources?: SourceId[] | SourceId | null
): Promise<PageRow[]> {
  const active = await resolveSources(siteId, sources);
  const batches = await gather(active, (source) =>
    source.pageRows(siteId, start, end)
  );

  return mergeSourceRows(batches)
    .slice(0, limit)
    .map(({ label, ...rest }) => ({ url: label, ...rest }));
}

export async function getTopKeywords(
  siteId: string,
  days = 28,
  limit = 50,
  sources?: SourceId[] | SourceId | null
): Promise<KeywordRow[]> {
  const range = parseRange(days);
  return getKeywordRowsForRange(siteId, range.start, range.end, limit, sources);
}

export async function getTopPages(
  siteId: string,
  days = 28,
  limit = 50,
  sources?: SourceId[] | SourceId | null
): Promise<PageRow[]> {
  const range = parseRange(days);
  return getPageRowsForRange(siteId, range.start, range.end, limit, sources);
}

export async function getDailyTraffic(
  siteId: string,
  days = 90,
  sources?: SourceId[] | SourceId | null
): Promise<DailyTraffic[]> {
  const range = parseRange(days);
  const active = await resolveSources(siteId, sources);
  const batches = await gather(active, (source) =>
    source.dailyTraffic(siteId, range.start, range.end)
  );

  const byDate = new Map<string, { clicks: number; impressions: number }>();
  for (const batch of batches) {
    for (const row of batch) {
      const entry = byDate.get(row.date) ?? { clicks: 0, impressions: 0 };
      entry.clicks += row.clicks;
      entry.impressions += row.impressions;
      byDate.set(row.date, entry);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, metrics]) => ({ date, ...metrics }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSitePeriodMetrics(
  siteId: string,
  days = 28,
  sources?: SourceId[] | SourceId | null
): Promise<{
  current: PeriodMetrics;
  previous: PeriodMetrics;
  deltas: {
    clicks: number;
    impressions: number;
    avgPosition: number;
    avgCtr: number;
  };
}> {
  const active = await resolveSources(siteId, sources);

  async function period(range: { start: Date; end: Date }): Promise<PeriodMetrics> {
    // Traffic rows carry the complete totals; query rows drop whatever a
    // source anonymises, so they only count distinct queries here.
    const [trafficBatches, pageBatches, queryBatches] = await Promise.all([
      gather(active, (source) =>
        source.dailyTraffic(siteId, range.start, range.end)
      ),
      gather(active, (source) =>
        source.pageRows(siteId, range.start, range.end)
      ),
      gather(active, (source) =>
        source.queryRows(siteId, range.start, range.end)
      ),
    ]);

    const traffic = trafficBatches.flat();
    const clicks = traffic.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = traffic.reduce((sum, row) => sum + row.impressions, 0);

    const positionRows = pageBatches
      .flat()
      .filter((row) => row.position != null && row.position > 0)
      .map((row) => ({
        position: row.position as number,
        impressions: row.impressions,
      }));

    const queries = new Set(queryBatches.flat().map((row) => row.key));

    return {
      clicks,
      impressions,
      avgPosition: weightedPosition(positionRows),
      avgCtr: impressions > 0 ? clicks / impressions : 0,
      uniqueKeywords: queries.size,
    };
  }

  const [current, previous] = await Promise.all([
    period(parseRange(days)),
    period(previousRange(days)),
  ]);

  return {
    current,
    previous,
    deltas: {
      clicks: calculatePercentChange(current.clicks, previous.clicks),
      impressions: calculatePercentChange(
        current.impressions,
        previous.impressions
      ),
      // Positive delta = improved (lower position is better)
      avgPosition: previous.avgPosition - current.avgPosition,
      avgCtr: calculatePercentChange(current.avgCtr, previous.avgCtr),
    },
  };
}

export type SourceTotals = {
  id: SourceId;
  label: string;
  clicks: number;
  impressions: number;
  uniqueKeywords: number;
};

/**
 * What each connected source contributed over the window.
 *
 * Deliberately narrower than calling getSitePeriodMetrics once per source: the
 * breakdown needs volume and a query count, not positions and not a previous
 * period, so it reads two datasets per source instead of six times two.
 */
export async function getSourceTotals(
  siteId: string,
  days = 28
): Promise<SourceTotals[]> {
  const range = parseRange(days);
  const active = await resolveSources(siteId);

  return Promise.all(
    active.map(async (source) => {
      const [traffic, queries] = await Promise.all([
        source.dailyTraffic(siteId, range.start, range.end),
        source.queryRows(siteId, range.start, range.end),
      ]);
      return {
        id: source.id,
        label: source.label,
        clicks: traffic.reduce((sum, row) => sum + row.clicks, 0),
        impressions: traffic.reduce((sum, row) => sum + row.impressions, 0),
        uniqueKeywords: new Set(queries.map((row) => row.key)).size,
      };
    })
  );
}

export function formatPosition(position: number): string {
  if (!Number.isFinite(position) || position <= 0) return "—";
  return position.toFixed(1);
}

export function formatCtr(ctr: number): string {
  return `${(ctr * 100).toFixed(2)}%`;
}

export function formatCompact(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

export function positionBand(position: number): "top3" | "top10" | "top20" | "deep" {
  // 0 means no source reported a rank for this row; it is not the top of page.
  if (position <= 0) return "deep";
  if (position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 20) return "top20";
  return "deep";
}
