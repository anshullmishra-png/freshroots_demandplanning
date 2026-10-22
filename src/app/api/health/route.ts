// Health check. Never returns secrets or environment values.
export function GET() {
  return Response.json({ status: "ok" });
}
