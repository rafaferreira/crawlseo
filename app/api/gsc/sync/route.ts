import { auth } from "@/lib/auth";
import { ReauthRequiredError } from "@/lib/google";
import { syncGSCDataForSite } from "@/lib/workers/gsc-sync";

/**
 * Search Console only. Kept for callers that predate
 * POST /api/sites/<id>/sync, which syncs every connected source.
 *
 * It delegates rather than repeating the upsert: the inline copy it used to
 * carry never wrote page, device or country on update, so rows written here
 * drifted from rows written by the worker.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { siteId } = (await req.json()) as { siteId?: string };
    if (!siteId) {
      return Response.json({ error: "Missing siteId" }, { status: 400 });
    }

    const result = await syncGSCDataForSite(session.user.id, siteId);
    if (!result.success) {
      const reauth = result.error === new ReauthRequiredError().message;
      return Response.json(
        { error: result.error, ...(reauth && { code: "REAUTH_REQUIRED" }) },
        { status: reauth ? 401 : 400 }
      );
    }

    return Response.json(result);
  } catch (error) {
    console.error("GSC sync error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
