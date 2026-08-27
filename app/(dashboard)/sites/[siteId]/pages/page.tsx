import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { getTopPages } from "@/lib/seo-metrics";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncButton } from "@/components/sites/sync-button";
import { CsvExportButton } from "@/components/ui/csv-export-button";
import { DataLagBadge } from "@/components/ui/data-lag-badge";
import { sourceScope } from "@/lib/sources";
import { SourceFilter } from "@/components/ui/source-filter";
import { PagesTable } from "@/components/sites/pages-table";

interface PagesPageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}

export default async function PagesPage({ params, searchParams }: PagesPageProps) {
  const session = await auth();
  const { siteId } = await params;
  const sources = await sourceScope(siteId, (await searchParams).source);

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, domain: true },
  });

  if (!site || site.userId !== session?.user?.id) {
    redirect("/sites");
  }

  const pages = await getTopPages(siteId, 28, 100, sources.ids);

  return (
    <div>
      <PageHeader
        eyebrow={site.domain}
        title="Pages"
        description="Landing pages over the last 28 days, aggregated across every connected source."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SourceFilter {...sources.filter} />
            <DataLagBadge />
            <CsvExportButton siteId={siteId} type="pages" />
            <SyncButton siteId={siteId} />
          </div>
        }
      />

      {sources.unavailable ? (
        <EmptyState
          icon="⊘"
          title={`No ${sources.unavailable} data for this site`}
          description="This site is not connected to that source. Switch the filter back, or connect it in Settings."
        />
      ) : pages.length === 0 ? (
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
