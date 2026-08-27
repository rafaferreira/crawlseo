import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enabledSources } from "@/lib/sources";

/**
 * Syncs every source connected to the site.
 *
 * One button for all of them: a button per source would multiply with the
 * registry, and nobody wants to remember which ones they already clicked.
 */
export async function POST(
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

    const sources = (await enabledSources(siteId)).filter((source) => source.sync);
    if (sources.length === 0) {
      return Response.json(
        { error: "No source connected to this site" },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      sources.map(async (source) => ({
        id: source.id,
        label: source.label,
        ...(await source.sync!(session.user!.id!, siteId)),
      }))
    );

    if (results.some((result) => result.needsReauth)) {
      return Response.json(
        {
          error: "Your Google connection expired. Please reconnect your account.",
          code: "REAUTH_REQUIRED",
          results,
        },
        { status: 401 }
      );
    }

    return Response.json({
      // Partial success is still success: one source being down should not
      // discard what the others just pulled.
      ok: results.some((result) => result.ok),
      results,
    });
  } catch (error) {
    console.error("Sync error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
