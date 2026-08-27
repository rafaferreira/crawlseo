import {
  bingPropertyFor,
  getBingDailyRows,
  getBingWindowRows,
  normaliseQueryKey,
  normaliseUrlKey,
} from "@/lib/bing/bing-read";
import { syncBingDataForSite } from "@/lib/workers/bing-sync";
import { formatCompact } from "@/lib/seo-metrics";
import type { DataSource } from "./types";

export const bingSource: DataSource = {
  id: "bing",
  label: "Bing",
  supplies: { queries: true, pages: true, traffic: true },
  windowCaveat:
    "Bing reports queries and pages in weekly buckets, so window edges are approximate by up to six days.",

  async isEnabled(siteId: string) {
    return (await bingPropertyFor(siteId)) !== null;
  },

  async sync(userId, siteId) {
    const result = await syncBingDataForSite(userId, siteId);
    if (!result.success) return { ok: false, detail: result.error ?? "sync failed" };
    return {
      ok: true,
      detail: `${formatCompact(result.daysUpserted)} days, ${formatCompact(
        result.queriesUpserted + result.pagesUpserted
      )} weekly rows`,
    };
  },

  async queryRows(siteId, start, end) {
    const rows = await getBingWindowRows(siteId, "query", start, end);
    return rows.map((row) => ({
      key: normaliseQueryKey(row.key),
      label: row.key,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    }));
  },

  async pageRows(siteId, start, end) {
    const rows = await getBingWindowRows(siteId, "page", start, end);
    return rows.map((row) => ({
      key: normaliseUrlKey(row.key),
      label: row.key,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    }));
  },

  async dailyTraffic(siteId, start, end) {
    // Bing's site traffic really is per day, so it lines up with Google's
    // without any bucket allowance.
    return getBingDailyRows(siteId, start, end);
  },
};
