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
            hint={`${formatDelta(traffic.deltas.clicks)} vs previous 28d`}
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
                  What bingbot actually fetched over {crawl.days} days · index
                  count as of {crawl.latestDate}. Search Console has no
                  equivalent API.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <MiniStat label="In index" value={crawl.inIndex} />
              <MiniStat label="Crawled" value={crawl.crawledPages} />
              <MiniStat label="2xx" value={crawl.code2xx} />
              <MiniStat label="301" value={crawl.code301} tone={crawl.code301 > 0 ? "warn" : undefined} />
              <MiniStat label="4xx" value={crawl.code4xx} tone={crawl.code4xx > 0 ? "danger" : undefined} />
              <MiniStat label="5xx" value={crawl.code5xx} tone={crawl.code5xx > 0 ? "danger" : undefined} />
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

function formatDelta(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "no change";
  return `${value > 0 ? "+" : ""}${value}%`;
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
  tone,
}: {
  label: string;
  value: number;
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
    </div>
  );
}
