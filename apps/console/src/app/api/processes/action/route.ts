import { NextResponse } from "next/server";
import { restartProcess, stopProcess } from "@/core/processes";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/processes/action {runtime, pid, action: "stop"|"restart"}
 * Перед сигналом перепроверяется, что PID всё ещё относится к рантайму.
 */
export async function POST(request: Request) {
  const { adapters } = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { runtime?: string; pid?: number; action?: "stop" | "restart" }
    | null;
  const { runtime, pid, action } = body ?? {};
  if (!runtime || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) {
    return NextResponse.json({ error: "нужны runtime, pid (>1), action" }, { status: 400 });
  }
  const adapter = adapters[runtime];
  if (!adapter?.processPattern) {
    return NextResponse.json({ error: `у рантайма ${runtime} нет детектора процессов` }, { status: 404 });
  }
  if (action !== "stop" && action !== "restart") {
    return NextResponse.json({ error: "action: stop | restart" }, { status: 400 });
  }

  const result =
    action === "stop" ? await stopProcess(pid, adapter.processPattern) : await restartProcess(pid, adapter.processPattern);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
