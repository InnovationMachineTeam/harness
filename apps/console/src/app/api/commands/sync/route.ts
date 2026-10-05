import { NextResponse } from "next/server";
import { commandSyncStatus, syncRuntimeCommands } from "@/core/commandSync";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/commands/sync - статус нативных команд рантаймов (план и наличие файлов, без записи). */
export async function GET() {
  const ctx = await serverContext();
  const statuses = await commandSyncStatus(ctx.repoRoot, ctx.state);
  return NextResponse.json({ statuses });
}

/** POST /api/commands/sync - регенерация команд в обязательной рабочей папке. */
export async function POST() {
  const ctx = await serverContext();
  const reports = await syncRuntimeCommands(ctx.repoRoot, ctx.state);
  const ok = reports.every((report) => !report.error);
  return NextResponse.json({ reports, ok });
}
