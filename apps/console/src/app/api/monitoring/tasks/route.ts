import { NextResponse } from "next/server";
import { providerPresetById } from "@/core/providers";
import { finalizeTaskStatuses, type TaskDTO, type TaskMeta } from "@/core/tasks";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const TOOL_LABELS: Record<string, string> = { openwiki: "OpenWiki", graphify: "Graphify" };

function toDto(meta: TaskMeta, adapterNames: Record<string, string>): TaskDTO {
  let executorLabel: string;
  let sessionHref: string | null = null;
  switch (meta.executor.type) {
    case "runtime":
      executorLabel = adapterNames[meta.executor.id] ?? meta.executor.id;
      sessionHref = `/runtime/${meta.executor.id}?tab=sessions`;
      break;
    case "provider":
      executorLabel = `провайдер · ${providerPresetById(meta.executor.id)?.label ?? meta.executor.id}`;
      break;
    default:
      executorLabel = `инструмент · ${TOOL_LABELS[meta.executor.id] ?? meta.executor.id}`;
      sessionHref = "/memory";
  }
  return { ...meta, executorLabel, sessionHref };
}

/**
 * GET /api/monitoring/tasks
 * Список задач консоли (промты, запросы провайдерам, сборки OpenWiki/Graphify),
 * новые сверху. Статусы "running" финализируются при чтении. Запуски независимы -
 * задачи выполняются параллельно.
 */
export async function GET() {
  const ctx = await serverContext();
  const metas = await finalizeTaskStatuses(ctx.repoRoot);
  const adapterNames = Object.fromEntries(
    Object.entries(ctx.adapters).map(([id, adapter]) => [id, adapter.displayName]),
  );
  return NextResponse.json({ tasks: metas.map((meta) => toDto(meta, adapterNames)) });
}
