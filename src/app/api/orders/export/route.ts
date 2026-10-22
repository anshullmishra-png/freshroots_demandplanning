import { guarded } from "@/lib/api/http";
import { exportOrders } from "@/lib/workflow/orders";

// CSV for procurement. Cells that could run as spreadsheet formulas are written as plain text (G-S7).
export const GET = guarded("export_orders", async ({ req, db, user }) => {
  const status = new URL(req.url).searchParams.get("status");
  const { filename, content } = await exportOrders(db, user, { status });
  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
