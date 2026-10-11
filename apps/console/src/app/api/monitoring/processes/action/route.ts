import { NextResponse } from "next/server";
import { stopProcessWhere } from "@/core/processes";
import { inventoryMatcher } from "@/core/processInventory";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/monitoring/processes/action {pid, action: "stop"}
 * Перед сигналом PID перепроверяется свежим снимком ps: процесс должен
 * относиться к инвентаризации (рантайм/MCP/провайдер/инструмент).
 */
export async function POST(request: Request) {
  const { repoRoot } = await serverContext();
  const body = (await request.json().catch(() => null)) as { pid?: number; action?: string } | null;
  const { pid, action } = body ?? {};
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) {
    return NextResponse.json({ error: "нужен pid (>1)" }, { status: 400 });
  }
  if (action !== "stop") {
    return NextResponse.json({ error: "action: stop" }, { status: 400 });
  }
  const matches = await inventoryMatcher(repoRoot);
  const result = await stopProcessWhere(pid, matches);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
