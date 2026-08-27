import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDailyTraffic } from "@/lib/seo-metrics";
import { getBingDailyTraffic } from "@/lib/bing-metrics";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId } = await params;
    const site = await db.site.findUnique({
      where: { id: siteId },
      select: { userId: true },
    });

    if (!site || site.userId !== session.user.id) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(_req.url);
    const days = Math.min(
      Math.max(Number(url.searchParams.get("days") || 90), 7),
      180
    );

    const [google, bing] = await Promise.all([
      getDailyTraffic(siteId, days),
      getBingDailyTraffic(siteId, days),
    ]);

    if (bing.length === 0) return Response.json(google);

    // Bing reports its own daily totals, so the two series line up day by day.
    // They stay in separate fields: added together they would double-count.
    const byDate = new Map(
      google.map((row) => [row.date, { ...row, bingClicks: 0, bingImpressions: 0 }])
    );
    for (const row of bing) {
      const existing = byDate.get(row.date) ?? {
        date: row.date,
        clicks: 0,
        impressions: 0,
        bingClicks: 0,
        bingImpressions: 0,
      };
      existing.bingClicks = row.clicks;
      existing.bingImpressions = row.impressions;
      byDate.set(row.date, existing);
    }

    return Response.json(
      Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
    );
  } catch (error) {
    console.error("Error fetching traffic:", error);
    return Response.json({ error: "Failed to load traffic" }, { status: 500 });
  }
}
