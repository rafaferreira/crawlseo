import Link from "next/link";
import { enabledSources } from "@/lib/sources";
import { formatCompact, getSitePeriodMetrics } from "@/lib/seo-metrics";

/**
 * What each connected source contributed to the combined numbers above.
 * With one source there is no split to show, so it renders nothing.
 */
export async function SourceBreakdown({
  siteId,
  days = 28,
  compareHref,
}: {
  siteId: string;
  days?: number;
  compareHref?: string;
}) {
  const sources = await enabledSources(siteId);
  if (sources.length < 2) return null;

  const rows = await Promise.all(
    sources.map(async (source) => ({
      id: source.id,
      label: source.label,
      metrics: (await getSitePeriodMetrics(siteId, days, [source.id])).current,
    }))
  );

  const totalClicks = rows.reduce((sum, row) => sum + row.metrics.clicks, 0);

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          By source · last {days} days
        </p>
        {compareHref && (
          <Link
            href={compareHref}
            className="text-atom-caption font-medium text-muted-foreground transition hover:text-primary"
          >
            Compare sources &rarr;
          </Link>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {rows.map((row) => {
          const share =
            totalClicks > 0
              ? Math.round((row.metrics.clicks / totalClicks) * 100)
              : 0;
          return (
            <div
              key={row.id}
              className="min-w-56 flex-1 rounded-lg border border-border/50 bg-panel/80 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{row.label}</p>
                <p className="font-data text-[11px] text-muted-foreground">
                  {share}% of clicks
                </p>
              </div>
              <p className="mt-1 font-data text-sm text-muted-foreground">
                {formatCompact(row.metrics.clicks)}{" "}
                {row.metrics.clicks === 1 ? "click" : "clicks"} ·{" "}
                {formatCompact(row.metrics.impressions)} impressions ·{" "}
                {row.metrics.uniqueKeywords.toLocaleString()} queries
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
