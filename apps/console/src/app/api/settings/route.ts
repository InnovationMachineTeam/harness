import { NextResponse } from "next/server";
import { invalidateDashboardCache } from "@/core/cache";
import { isActiveProvider, parseTaskProviderId, providerPresetById } from "@/core/providers";
import { readProviderEntry } from "@/core/providerSettings";
import { workspaceDirs, normalizeAgentExecutor, normalizeAgentHistoryLimit, normalizeBilling, type TaskKind, type TaskRuntimes } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const TASKS: TaskKind[] = ["promptExecution", "skillCreation", "optimization"];

/** GET /api/settings - рантаймы под задачи, провайдер AI SDK по умолчанию, исполнитель агента и лимит истории. */
export async function GET() {
  const { state, adapters } = await serverContext();
  return NextResponse.json({
    defaultRuntime: state.defaultRuntime,
    defaultProvider: state.defaultProvider,
    taskRuntimes: state.settings.taskRuntimes,
    agentExecutor: state.settings.agentExecutor,
    agentHistoryLimit: state.settings.agentHistoryLimit,
    installed: Object.keys(adapters),
    workflowSettings: state.settings.workflows,
    billing: state.settings.billing,
    workspaces: workspaceDirs(state),
  });
}

/** PUT /api/settings {taskRuntimes, defaultProvider?, agentExecutor?, agentHistoryLimit?}; значение - id рантайма или "provider:<id>". */
export async function PUT(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { taskRuntimes?: Partial<TaskRuntimes>; defaultProvider?: string | null; agentExecutor?: string | null; agentHistoryLimit?: number | null; workflowSettings?: Partial<typeof ctx.state.settings.workflows>; billing?: unknown }
    | null;
  const incoming = body?.taskRuntimes;
  if (!incoming && body?.defaultProvider === undefined && body?.agentExecutor === undefined && body?.agentHistoryLimit === undefined && !body?.workflowSettings && body?.billing === undefined) {
    return NextResponse.json({ error: "нужен taskRuntimes, defaultProvider, agentExecutor, agentHistoryLimit, workflowSettings или billing" }, { status: 400 });
  }

  if (incoming) {
    for (const task of TASKS) {
      const value = incoming[task];
      if (value === undefined) continue;
      if (value !== null) {
        const providerId = parseTaskProviderId(value);
        if (providerId !== null) {
          const preset = providerPresetById(providerId);
          // активность проверяется по собранной записи: ключ нужен из key.env
          const entry = preset
            ? await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[providerId] ?? null)
            : undefined;
          if (!preset || !isActiveProvider(preset, entry)) {
            return NextResponse.json(
              { error: `провайдер для ${task} не активен: ${providerId} (заполните поля и пройдите проверку)` },
              { status: 400 },
            );
          }
        } else if (!ctx.adapters[value]) {
          return NextResponse.json({ error: `неизвестный рантайм для ${task}: ${value}` }, { status: 400 });
        }
      }
      ctx.state.settings.taskRuntimes[task] = value;
    }
  }

  if (body?.defaultProvider !== undefined) {
    const value = body.defaultProvider;
    if (value !== null) {
      const preset = providerPresetById(value);
      if (!preset) {
        return NextResponse.json({ error: `неизвестный провайдер: ${value}` }, { status: 400 });
      }
      const entry = await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[value] ?? null);
      if (!isActiveProvider(preset, entry)) {
        return NextResponse.json(
          { error: `провайдер не активен: ${value} (заполните поля и пройдите проверку)` },
          { status: 400 },
        );
      }
    }
    ctx.state.defaultProvider = value;
  }

  if (body?.agentExecutor !== undefined) {
    const value = normalizeAgentExecutor(body.agentExecutor);
    if (body.agentExecutor !== null && value === null) {
      return NextResponse.json({ error: "неверное значение исполнителя агента" }, { status: 400 });
    }
    if (value && value !== "provider") {
      const providerId = parseTaskProviderId(value);
      if (providerId !== null) {
        const preset = providerPresetById(providerId);
        const entry = preset
          ? await readProviderEntry(ctx.repoRoot, preset, ctx.state.providers.entries[providerId] ?? null)
          : undefined;
        if (!preset || !isActiveProvider(preset, entry)) {
          return NextResponse.json(
            { error: `провайдер не активен: ${providerId} (заполните поля и пройдите проверку)` },
            { status: 400 },
          );
        }
      } else if (!ctx.adapters[value]) {
        return NextResponse.json({ error: `неизвестный рантайм: ${value}` }, { status: 400 });
      }
    }
    ctx.state.settings.agentExecutor = value;
  }

  if (body?.agentHistoryLimit !== undefined) {
    const value = normalizeAgentHistoryLimit(body.agentHistoryLimit);
    if (body.agentHistoryLimit !== null && value === null) {
      return NextResponse.json({ error: "лимит истории - целое число от 0 до 500 (0 - без ограничения)" }, { status: 400 });
    }
    ctx.state.settings.agentHistoryLimit = value;
  }

  if (body?.workflowSettings) {
    const privacy = body.workflowSettings.privacy;
    if (privacy && !["full", "metadata", "aggregates"].includes(privacy)) return NextResponse.json({ error: "неверный privacy mode" }, { status: 400 });
    const incomingCapabilities = body.workflowSettings.capabilities;
    if (incomingCapabilities) {
      if (!["block", "warn"].includes(incomingCapabilities.defaultPolicy)) return NextResponse.json({ error: "неверная capability policy" }, { status: 400 });
      if (Object.values(incomingCapabilities.workspacePolicies).some((value) => !["block", "warn"].includes(value))) return NextResponse.json({ error: "неверная workspace capability policy" }, { status: 400 });
    }
    ctx.state.settings.workflows = {
      ...ctx.state.settings.workflows,
      ...body.workflowSettings,
      capabilities: incomingCapabilities ?? ctx.state.settings.workflows.capabilities,
    };
  }

  if (body?.billing !== undefined) {
    const nextBilling = normalizeBilling(body.billing);
    // Частичный merge: запрос обновляет только переданные разделы (например, один рантайм).
    ctx.state.settings.billing = {
      runtimes: { ...ctx.state.settings.billing.runtimes, ...nextBilling.runtimes },
      providers: { ...ctx.state.settings.billing.providers, ...nextBilling.providers },
      deposits: { ...ctx.state.settings.billing.deposits, ...nextBilling.deposits },
    };
  }

  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({
    ok: true,
    taskRuntimes: ctx.state.settings.taskRuntimes,
    defaultProvider: ctx.state.defaultProvider,
    agentExecutor: ctx.state.settings.agentExecutor,
    agentHistoryLimit: ctx.state.settings.agentHistoryLimit,
    workflowSettings: ctx.state.settings.workflows,
    billing: ctx.state.settings.billing,
  });
}
