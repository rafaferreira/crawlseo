import {
  bingPropertyFor,
  getBingDailyRows,
  getBingWindowRows,
} from "@/lib/bing/bing-read";
import {
  normaliseQueryKey,
  normaliseUrlKey,
} from "@/lib/sources/keys";
import { syncBingDataForSite } from "@/lib/workers/bing-sync";
import { formatLargeNumber } from "@/lib/date-utils";
import type { DataSource } from "./types";

export const bingSource: DataSource = {
  id: "bing",
  label: "Bing",
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
      detail: `${formatLargeNumber(result.daysUpserted)} days, ${formatLargeNumber(
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
