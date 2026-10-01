import { NextResponse } from "next/server";
import { listProcesses } from "@/core/processes";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/processes?runtime= - процессы рантайма с cpu/mem/uptime. */
export async function GET(request: Request) {
  const { adapters } = await serverContext();
  const runtime = new URL(request.url).searchParams.get("runtime");
  if (!runtime) return NextResponse.json({ error: "укажите ?runtime=" }, { status: 400 });
  const adapter = adapters[runtime];
  if (!adapter?.processPattern) {
    return NextResponse.json({ error: `у рантайма ${runtime} нет детектора процессов` }, { status: 404 });
  }
  const processes = listProcesses(adapter.processPattern);
  return NextResponse.json({
    processes,
    totals: {
      count: processes.length,
      cpu: Number(processes.reduce((s, p) => s + p.cpu, 0).toFixed(1)),
      mem: Number(processes.reduce((s, p) => s + p.mem, 0).toFixed(1)),
      apps: processes.filter((p) => p.kind === "app").length,
    },
  });
}
