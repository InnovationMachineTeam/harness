import { NextResponse } from "next/server";
import { commandSyncStatus, syncRuntimeCommands } from "@/core/commandSync";
import { agentSyncStatus, syncRuntimeAgents } from "@/core/agentSync";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/commands/sync - статус нативных команд и субагентов рантаймов (план и наличие файлов, без записи). */
export async function GET() {
  const ctx = await serverContext();
  const statuses = await commandSyncStatus(ctx.repoRoot, ctx.state);
  const agentStatuses = await agentSyncStatus(ctx.repoRoot);
  return NextResponse.json({ statuses, agentStatuses });
}

/** POST /api/commands/sync - регенерация команд и субагентов-персон в обязательной рабочей папке. */
export async function POST() {
  const ctx = await serverContext();
  const reports = await syncRuntimeCommands(ctx.repoRoot, ctx.state);
  const agentReports = await syncRuntimeAgents(ctx.repoRoot);
  const ok = reports.every((report) => !report.error) && agentReports.every((report) => !report.error);
  return NextResponse.json({ reports, agentReports, ok });
}
