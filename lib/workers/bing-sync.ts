import { db } from "@/lib/db";
import {
  fetchBingCrawlStats,
  fetchBingSearchStats,
  fetchBingTraffic,
} from "@/lib/bing";

export interface BingSyncResult {
  success: boolean;
  daysUpserted: number;
  queriesUpserted: number;
  pagesUpserted: number;
  error?: string;
}

type DailyRow = {
  clicks?: number;
  impressions?: number;
  crawledPages?: number;
  inIndex?: number;
  inLinks?: number;
  code2xx?: number;
  code301?: number;
  code302?: number;
  code4xx?: number;
  code5xx?: number;
  blockedByRobots?: number;
  crawlErrors?: number;
};

function utcDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Prisma has no upsertMany; small batches keep the round trips off the clock. */
async function inChunks<T>(
  items: T[],
  size: number,
  run: (item: T) => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/**
 * Pulls everything Bing has for one site and upserts it.
 *
 * No endpoint accepts a date range, so every sync is a full refresh: Bing
 * returns its whole history each time and the upserts make that idempotent.
 * That also means there is no backfill script to write, unlike GSC.
 */
export async function syncBingDataForSite(
  userId: string,
  siteId: string
): Promise<BingSyncResult> {
  const empty = { daysUpserted: 0, queriesUpserted: 0, pagesUpserted: 0 };

  try {
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { userId: true, bingSite: true },
    });

    if (!site) throw new Error("Site not found");
    if (site.userId !== userId) {
      throw new Error("Unauthorized: Site does not belong to user");
    }
    if (!site.bingSite) {
      throw new Error("Site does not have a Bing Webmaster property connected");
    }

    const [traffic, queries, pages, crawl] = await Promise.all([
      fetchBingTraffic(userId, site.bingSite),
      fetchBingSearchStats(userId, site.bingSite, "query"),
      fetchBingSearchStats(userId, site.bingSite, "page"),
      fetchBingCrawlStats(userId, site.bingSite),
    ]);

    console.log(
      `[Bing Sync] ${site.bingSite}: ${traffic.length} traffic days, ` +
        `${queries.length} query weeks, ${pages.length} page weeks, ` +
        `${crawl.length} crawl days`
    );

    // Traffic and crawl stats are both keyed by (site, day), so they share a row.
    const daily = new Map<string, DailyRow>();
    for (const day of traffic) {
      daily.set(day.date, {
        ...daily.get(day.date),
        clicks: day.clicks,
        impressions: day.impressions,
      });
    }
    for (const day of crawl) {
      daily.set(day.date, {
        ...daily.get(day.date),
        crawledPages: day.crawledPages,
        inIndex: day.inIndex,
        inLinks: day.inLinks,
        code2xx: day.code2xx,
        code301: day.code301,
        code302: day.code302,
        code4xx: day.code4xx,
        code5xx: day.code5xx,
        blockedByRobots: day.blockedByRobots,
        crawlErrors: day.crawlErrors,
      });
    }

    let daysUpserted = 0;
    await inChunks(Array.from(daily.entries()), 25, async ([date, values]) => {
      await db.bingDaily.upsert({
        where: { siteId_date: { siteId, date: utcDay(date) } },
        create: { siteId, date: utcDay(date), ...values },
        update: values,
      });
      daysUpserted++;
    });

    const counts = { query: 0, page: 0 };
    for (const kind of ["query", "page"] as const) {
      const rows = kind === "query" ? queries : pages;
      await inChunks(rows, 25, async (row) => {
        const values = {
          clicks: row.clicks,
          impressions: row.impressions,
          avgImpressionPosition: row.avgImpressionPosition,
          avgClickPosition: row.avgClickPosition,
        };
        await db.bingSearchWeekly.upsert({
          where: {
            siteId_kind_key_weekEnding: {
              siteId,
              kind,
              key: row.key,
              weekEnding: utcDay(row.weekEnding),
            },
          },
          create: {
            siteId,
            kind,
            key: row.key,
            weekEnding: utcDay(row.weekEnding),
            ...values,
          },
          update: values,
        });
        counts[kind]++;
      });
    }

    return {
      success: true,
      daysUpserted,
      queriesUpserted: counts.query,
      pagesUpserted: counts.page,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Bing Sync] Error syncing site ${siteId}:`, message);
    return { success: false, ...empty, error: message };
  }
}

/** Syncs every site of a user that has a Bing property connected. */
export async function syncAllUserBingSites(userId: string): Promise<
  Array<{ siteId: string; domain: string; result: BingSyncResult }>
> {
  const sites = await db.site.findMany({
    where: { userId, bingSite: { not: null } },
    select: { id: true, domain: true },
  });

  const results = [];
  for (const site of sites) {
    results.push({
      siteId: site.id,
      domain: site.domain,
      result: await syncBingDataForSite(userId, site.id),
    });
  }
  return results;
}
