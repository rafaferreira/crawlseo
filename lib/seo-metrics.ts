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

export function parseRange(days: number) {
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

async function gather<T>(
  sources: DataSource[],
  supplies: "queries" | "pages" | "traffic",
  read: (source: DataSource) => Promise<T[]>
): Promise<T[][]> {
  return Promise.all(
    sources.filter((source) => source.supplies[supplies]).map(read)
  );
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
  const batches = await gather(active, "queries", (source) =>
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
  const batches = await gather(active, "pages", (source) =>
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
  const batches = await gather(active, "traffic", (source) =>
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
      gather(active, "traffic", (source) =>
        source.dailyTraffic(siteId, range.start, range.end)
      ),
      gather(active, "pages", (source) =>
        source.pageRows(siteId, range.start, range.end)
      ),
      gather(active, "queries", (source) =>
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
  if (position > 0 && position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 20) return "top20";
  return "deep";
}
