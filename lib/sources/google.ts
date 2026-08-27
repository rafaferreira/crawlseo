import { db } from "@/lib/db";
import { normaliseQueryKey, normaliseUrlKey } from "@/lib/bing/bing-read";
import type { DataSource } from "./types";

export const googleSource: DataSource = {
  id: "google",
  label: "Google",
  supplies: { queries: true, pages: true, traffic: true },

  async isEnabled(siteId: string) {
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { gscProperty: true },
    });
    return Boolean(site?.gscProperty);
  },

  async queryRows(siteId, start, end) {
    const rows = await db.keyword.findMany({
      where: { siteId, date: { gte: start, lte: end } },
      select: { query: true, clicks: true, impressions: true, position: true },
    });
    return rows.map((row) => ({
      key: normaliseQueryKey(row.query),
      label: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position > 0 ? row.position : null,
    }));
  },

  async pageRows(siteId, start, end) {
    const rows = await db.page.findMany({
      where: { siteId, date: { gte: start, lte: end } },
      select: { url: true, clicks: true, impressions: true, position: true },
    });
    return rows.map((row) => ({
      key: normaliseUrlKey(row.url),
      label: row.url,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position > 0 ? row.position : null,
    }));
  },

  async dailyTraffic(siteId, start, end) {
    // Page rows carry the complete totals; query rows drop the queries Google
    // anonymises, so they are only a fallback when no page rows exist yet.
    const pages = await db.page.findMany({
      where: { siteId, date: { gte: start, lte: end } },
      select: { date: true, clicks: true, impressions: true },
      orderBy: { date: "asc" },
    });

    const source =
      pages.length > 0
        ? pages
        : await db.keyword.findMany({
            where: { siteId, date: { gte: start, lte: end } },
            select: { date: true, clicks: true, impressions: true },
            orderBy: { date: "asc" },
          });

    const byDate = new Map<string, { clicks: number; impressions: number }>();
    for (const row of source) {
      const date = row.date.toISOString().slice(0, 10);
      const entry = byDate.get(date) ?? { clicks: 0, impressions: 0 };
      entry.clicks += row.clicks;
      entry.impressions += row.impressions;
      byDate.set(date, entry);
    }

    return Array.from(byDate.entries())
      .map(([date, metrics]) => ({ date, ...metrics }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
};
