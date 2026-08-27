import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { getTopKeywords } from "@/lib/seo-metrics";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SyncButton } from "@/components/sites/sync-button";
import { CsvExportButton } from "@/components/ui/csv-export-button";
import { DataLagBadge } from "@/components/ui/data-lag-badge";
import { sourceScope } from "@/lib/sources";
import { SourceFilter } from "@/components/ui/source-filter";
import { KeywordsTable } from "@/components/sites/keywords-table";

interface KeywordsPageProps {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}

export default async function KeywordsPage({ params, searchParams }: KeywordsPageProps) {
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

  // Load a wide set so position/impression filters aren't capped to top-by-clicks.
  const keywords = await getTopKeywords(siteId, 28, 1000, sources.ids);

  return (
    <div>
      <PageHeader
        eyebrow={site.domain}
        title="Keywords"
        description="Queries with impressions in the last 28 days, aggregated across days and across every connected source."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SourceFilter {...sources.filter} />
            <DataLagBadge />
            <CsvExportButton siteId={siteId} type="keywords" />
            <SyncButton siteId={siteId} />
          </div>
        }
      />

      {keywords.length === 0 ? (
        <EmptyState
          icon="⌘"
          title="No keywords yet"
          description="Sync Google Search Console to populate query-level performance."
        />
      ) : (
        <KeywordsTable keywords={keywords} />
      )}
    </div>
  );
}
