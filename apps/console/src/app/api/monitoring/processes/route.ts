import { NextResponse } from "next/server";
import { buildProcessInventory } from "@/core/processInventory";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring/processes - инвентаризация процессов консоли:
 * рантаймы, MCP-серверы, локальные провайдеры, инструменты; cpu/mem/uptime,
 * маркер "безопасно остановить" (дубликат/stale/orphan) с причиной.
 */
export async function GET() {
  const { repoRoot } = await serverContext();
  const inventory = await buildProcessInventory(repoRoot);
  return NextResponse.json(inventory);
}
