import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { DashboardMetrics } from "@/components/dashboard/metrics";
import { TrafficChart } from "@/components/dashboard/traffic-chart";
import { TopKeywords } from "@/components/dashboard/top-keywords";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncButton } from "@/components/sites/sync-button";
import { DataLagBadge } from "@/components/ui/data-lag-badge";
import {
  CrawlButton,
  VitalsButton,
} from "@/components/sites/action-buttons";
import { CsvExportButton } from "@/components/ui/csv-export-button";
import { getAllOpportunities } from "@/lib/seo-opportunities";
import { getBingPeriodMetrics, getEngineComparison } from "@/lib/bing-metrics";
import { formatCompact } from "@/lib/seo-metrics";

interface SitePageProps {
  params: Promise<{ siteId: string }>;
}

export default async function SiteOverviewPage({ params }: SitePageProps) {
  const session = await auth();
  const { siteId } = await params;

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: {
      userId: true,
      domain: true,
      gscProperty: true,
      bingSite: true,
      _count: { select: { keywords: true } },
    },
  });

  if (!site || site.userId !== session?.user?.id) {
    redirect("/sites");
  }

  const latestCrawl = await db.crawl.findFirst({
    where: { siteId, status: "COMPLETED" },
    orderBy: { finishedAt: "desc" },
    select: { healthScore: true, issuesFound: true, pagesFound: true, finishedAt: true },
  });

  const latestVital = await db.vitalsReport.findFirst({
    where: { siteId },
    orderBy: { date: "desc" },
    select: { perfScore: true, lcp: true, url: true },
  });

  const opportunities =
    site._count.keywords > 0
      ? await getAllOpportunities(siteId)
      : null;

  const bing = site.bingSite
    ? {
        traffic: await getBingPeriodMetrics(siteId, 28),
        comparison: await getEngineComparison(siteId, 90),
      }
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Site"
        title={site.domain}
        description={site.gscProperty || "Search Console property"}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <DataLagBadge />
            <SyncButton siteId={siteId} />
            <CrawlButton siteId={siteId} />
            <VitalsButton siteId={siteId} />
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          ["Opportunities", "opportunities"],
          ["Keywords", "keywords"],
          ["Saved Keywords", "saved-keywords"],
          ["Pages", "pages"],
          ["Crawl", "crawl"],
          ["Vitals", "vitals"],
          ["Bing vs Google", "bing"],
          ["Alerts", "alerts"],
          ["Settings", "settings"],
        ].map(([label, path]) => (
          <Link
            key={path}
            href={`/sites/${siteId}/${path}`}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-atom-caption font-medium text-muted-foreground shadow-[var(--shadow-1)] transition hover:border-primary hover:text-primary"
          >
            {label}
          </Link>
        ))}
      </div>

      {site._count.keywords === 0 ? (
        <EmptyState
          icon="↻"
          title="Waiting for GSC data"
          description="Run a sync to pull keywords, pages, and traffic for the last 28 days."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="panel p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Crawl health
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {latestCrawl?.healthScore != null ? `${latestCrawl.healthScore}/100` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {latestCrawl
                  ? `${latestCrawl.pagesFound} pages · ${latestCrawl.issuesFound} issues`
                  : "Run a crawl"}
              </p>
            </div>
            <div className="panel p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Opportunities
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold text-signal">
                {opportunities?.feed.length ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">action items this period</p>
            </div>
            <div className="panel p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Latest perf score
              </p>
              <p className="mt-1 font-heading text-2xl font-semibold text-foreground">
                {latestVital?.perfScore ?? "—"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {latestVital?.url || "Check vitals"}
              </p>
            </div>
          </div>

          <DashboardMetrics siteId={siteId} />

          {bing && (
            <Link
              href={`/sites/${siteId}/bing`}
              className="panel flex flex-wrap items-center justify-between gap-4 p-4 transition hover:border-primary/40"
            >
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Bing · last 28 days
                </p>
                <p className="mt-1 font-heading text-xl font-semibold text-foreground">
                  {formatCompact(bing.traffic.current.clicks)} clicks ·{" "}
                  {formatCompact(bing.traffic.current.impressions)} impressions
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-signal">
                  {bing.comparison.counts.bing.toLocaleString()}
                </span>{" "}
                queries only Bing reports ·{" "}
                {bing.comparison.counts.both.toLocaleString()} on both engines
              </p>
            </Link>
          )}
          <TrafficChart siteId={siteId} />
          <TopKeywords siteId={siteId} />

          <div className="flex flex-wrap gap-2">
            <CsvExportButton siteId={siteId} type="keywords" />
            <CsvExportButton siteId={siteId} type="pages" />
          </div>
        </div>
      )}
    </div>
  );
}
