import { homedir } from "node:os";
import { NextResponse } from "next/server";
import { runtimeMemory } from "@/core/memory";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/runtimes[?runtime=<id>]
 * Memory-файлы рантаймов по рабочим папкам (+ "Глобальные"); с ?runtime= -
 * только один рантайм (вкладка "Память" на странице рантайма).
 */
export async function GET(request: Request) {
  const { state, repoRoot, adapters } = await serverContext();
  const home = homedir();
  const runtime = new URL(request.url).searchParams.get("runtime") ?? undefined;
  const runtimes = await runtimeMemory(
    repoRoot,
    home,
    fsSignals,
    workspaceDirs(state),
    adapters,
    runtime ? [runtime] : undefined,
  );
  return NextResponse.json({ runtimes });
}
