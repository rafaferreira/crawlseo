import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { getTopPages } from "@/lib/seo-metrics";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncButton } from "@/components/sites/sync-button";
import { CsvExportButton } from "@/components/ui/csv-export-button";
import { DataLagBadge } from "@/components/ui/data-lag-badge";
import {
  enabledSources,
  parseSourceParam,
  resolveSources,
} from "@/lib/sources";
import { SourceFilter } from "@/components/ui/source-filter";
import { PagesTable } from "@/components/sites/pages-table";

interface PagesPageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}

export default async function PagesPage({ params, searchParams }: PagesPageProps) {
  const session = await auth();
  const { siteId } = await params;
  const requestedSource = parseSourceParam((await searchParams).source);

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, domain: true },
  });

  if (!site || site.userId !== session?.user?.id) {
    redirect("/sites");
  }

  const [available, active] = await Promise.all([
    enabledSources(siteId),
    resolveSources(siteId, requestedSource),
  ]);
  const activeIds = active.map((source) => source.id);
  const pages = await getTopPages(siteId, 28, 100, activeIds);

  return (
    <div>
      <PageHeader
        eyebrow={site.domain}
        title="Pages"
        description="Landing pages over the last 28 days, aggregated across every connected source."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SourceFilter
              sources={available.map((source) => ({
                id: source.id,
                label: source.label,
              }))}
              active={activeIds.length === available.length ? "all" : activeIds[0]}
              caveat={available
                .map((source) => source.windowCaveat)
                .filter(Boolean)
                .join(" ")}
            />
            <DataLagBadge />
            <CsvExportButton siteId={siteId} type="pages" />
            <SyncButton siteId={siteId} />
          </div>
        }
      />

      {pages.length === 0 ? (
        <EmptyState
          icon="◫"
          title="No pages yet"
          description="Sync GSC to pull page-level clicks, impressions, and positions."
        />
      ) : (
        <PagesTable
          domain={site.domain}
          rows={pages.map((p) => ({
            url: p.url,
            position: p.position,
            clicks: p.clicks,
            impressions: p.impressions,
            ctr: p.ctr,
          }))}
        />
      )}
    </div>
  );
}
