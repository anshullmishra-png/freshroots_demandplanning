import { guarded } from "@/lib/api/http";
import { exportMetrics } from "@/lib/metrics/export";

export const GET = guarded("export_metrics", async ({ req, db, user }) => {
  const { filename, content } = await exportMetrics(db, user, new URL(req.url).searchParams.get("kind"));
  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
