import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { EngineComparisonTable } from "@/components/bing/engine-comparison-table";
import {
  getBingCrawlSummary,
  getBingPeriodMetrics,
  getBingTopRows,
  getEngineComparison,
} from "@/lib/bing-metrics";
import { formatCompact, formatCtr } from "@/lib/seo-metrics";
import { formatDeltaPercent } from "@/lib/format";

interface Props {
  params: Promise<{ siteId: string }>;
}

const COMPARISON_DAYS = 90;

export default async function BingPage({ params }: Props) {
  const session = await auth();
  const { siteId } = await params;

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, domain: true, bingSite: true },
  });

  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  if (!site.bingSite) {
    return (
      <div>
        <PageHeader
          eyebrow={site.domain}
          title="Bing vs Google"
          description="Bing Webmaster Tools is not connected yet"
        />
        <EmptyState
          icon="B"
          title="No Bing property connected"
          description="Add a Bing Webmaster Tools API key and pick this site's property in Settings, then run a sync."
        />
        <div className="mt-4">
          <Link
            href={`/sites/${siteId}/settings`}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-atom-caption font-medium text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            Open settings
          </Link>
        </div>
      </div>
    );
  }

  const [traffic, crawl, comparison, topPages] = await Promise.all([
    getBingPeriodMetrics(siteId, 28),
    getBingCrawlSummary(siteId, 28),
    getEngineComparison(siteId, COMPARISON_DAYS),
    getBingTopRows(siteId, "page", COMPARISON_DAYS, 15),
  ]);

  const wideGaps = comparison.rows.filter(
    (row) => row.gap != null && Math.abs(row.gap) >= 5
  ).length;

  return (
    <div>
      <PageHeader
        eyebrow={site.domain}
        title="Bing vs Google"
        description={site.bingSite}
      />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Bing clicks · 28d"
            value={formatCompact(traffic.current.clicks)}
            hint={`${formatDeltaPercent(traffic.deltas.clicks)} vs previous 28d`}
          />
          <Stat
            label="Bing impressions · 28d"
            value={formatCompact(traffic.current.impressions)}
            hint={`CTR ${formatCtr(traffic.current.ctr)}`}
          />
          <Stat
            label="Only Bing sees them"
            value={comparison.counts.bing.toLocaleString()}
            hint={`of ${comparison.rows.length.toLocaleString()} queries in ${COMPARISON_DAYS}d`}
            accent
          />
          <Stat
            label="Position gaps ≥ 5"
            value={wideGaps.toLocaleString()}
            hint={`${comparison.counts.both.toLocaleString()} queries on both engines`}
          />
        </div>

        {crawl && (
          <div className="panel p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="font-heading text-atom-subheader font-semibold text-foreground">
                  Bing crawler
                </h3>
                <p className="text-atom-caption text-muted-foreground">
                  Pages fetched over {crawl.days} days; every status is Bing&apos;s
                  running count of known URLs on {crawl.latestDate}, with the
                  move since {crawl.firstDate}. Search Console has no
                  equivalent API.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <MiniStat label="In index" value={crawl.inIndex} change={crawl.changes.inIndex} />
              <MiniStat label={`Crawled · ${crawl.days}d`} value={crawl.crawledPages} />
              <MiniStat label="Known 2xx" value={crawl.code2xx} />
              <MiniStat label="Known 301" value={crawl.code301} change={crawl.changes.code301} tone={crawl.code301 > 0 ? "warn" : undefined} />
              <MiniStat label="Known 4xx" value={crawl.code4xx} change={crawl.changes.code4xx} tone={crawl.code4xx > 0 ? "danger" : undefined} />
              <MiniStat label="Known 5xx" value={crawl.code5xx} change={crawl.changes.code5xx} tone={crawl.code5xx > 0 ? "danger" : undefined} />
              <MiniStat label="Blocked" value={crawl.blockedByRobots} />
            </div>
          </div>
        )}

        <div>
          <div className="mb-3">
            <h3 className="font-heading text-atom-subheader font-semibold text-foreground">
              Query coverage
            </h3>
            <p className="text-atom-caption text-muted-foreground">
              Last {COMPARISON_DAYS} days. Volume is never added up: Bing reports
              weekly buckets and Search Console hides anonymised queries. A
              positive gap means Bing ranks the query better than Google does.
            </p>
          </div>
          <EngineComparisonTable rows={comparison.rows} />
        </div>

        {topPages.length > 0 && (
          <div className="panel p-5">
            <h3 className="font-heading text-atom-subheader font-semibold text-foreground">
              Top pages on Bing
            </h3>
            <ul className="mt-3 space-y-2">
              {topPages.map((page) => (
                <li
                  key={page.key}
                  className="flex items-center justify-between gap-4 border-b border-border/40 pb-2 text-sm last:border-0"
                >
                  <span className="truncate text-muted-foreground">{page.key}</span>
                  <span className="shrink-0 font-data text-xs text-foreground">
                    {page.clicks} clicks · {page.impressions} impr ·{" "}
                    {page.position != null ? `pos ${page.position}` : "pos —"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-heading text-2xl font-semibold ${
          accent ? "text-signal" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  change,
  tone,
}: {
  label: string;
  value: number;
  change?: number;
  tone?: "warn" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-panel/80 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-data text-lg font-semibold ${
          tone === "danger"
            ? "text-danger"
            : tone === "warn"
              ? "text-warning"
              : "text-foreground"
        }`}
      >
        {value.toLocaleString()}
      </p>
      {change !== undefined && change !== 0 && (
        <p className="text-[10px] text-muted-foreground">
          {change > 0 ? "+" : ""}
          {change.toLocaleString()} in window
        </p>
      )}
    </div>
  );
}
