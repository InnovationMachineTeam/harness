import { NextResponse } from "next/server";
import {
  collectHarnessSkills,
  setSkillDefault,
  setSkillRuntimeOverride,
  setUseGlobalSkills,
  skillDefault,
  skillEffective,
  skillRuntimeOverride,
} from "@/core/skills";
import { applySkillToggle } from "@/core/skillHooks";
import { syncSkillLinks } from "@/core/skillLinks";
import { syncRuntimeCommands } from "@/core/commandSync";
import { invalidateDashboardCache } from "@/core/cache";
import type { ConsoleState } from "@/core/state";
import type { SkillItem } from "@/core/types";
import { fsSignals } from "@/lib/signals/fs";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/skills?runtime=<id> - навыки рантайма (origin runtime: собственные
 * каталоги; плюс harness-навыки .agents/skills) и глобальный toggle useGlobal.
 * Тогглы - оверлей консоли; файлы рантайма не изменяются.
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const runtime = new URL(request.url).searchParams.get("runtime");
  if (!runtime) return NextResponse.json({ error: "укажите ?runtime=" }, { status: 400 });

  const { workspaceDirs } = await import("@/core/state");
  const { homedir } = await import("node:os");
  const probeCtx = { repoRoot: ctx.repoRoot, home: homedir(), fs: fsSignals, workspaces: workspaceDirs(ctx.state) };

  const harnessItems = await collectHarnessSkills(probeCtx);
  let runtimeItems: SkillItem[] = [];
  const adapter = ctx.adapters[runtime];
  if (adapter?.listSkills) {
    runtimeItems = await adapter.listSkills(probeCtx);
  }

  const decorate = (item: SkillItem) => ({
    ...item,
    defaultEnabled: skillDefault(ctx.state, item.id),
    runtimeOverride: skillRuntimeOverride(ctx.state, item.id, runtime),
    effective: skillEffective(ctx.state, item.id, runtime),
  });

  return NextResponse.json({
    supported: Boolean(adapter?.listSkills),
    useGlobal: ctx.state.skills.useGlobal,
    items: [...runtimeItems.map(decorate), ...harnessItems.map(decorate)],
  });
}

/** Применить хуки переключения ко всем рантаймам, у которых изменился effective. */
async function applyDefaultToggleHooks(
  repoRoot: string,
  state: ConsoleState,
  itemId: string,
  before: Set<string>,
): Promise<string[]> {
  const { ADAPTER_IDS: runtimeIds } = await import("@/runtimes");
  const errors: string[] = [];
  for (const runtime of runtimeIds) {
    const now = skillEffective(state, itemId, runtime);
    const was = before.has(runtime);
    if (now === was) continue;
    const outcome = await applySkillToggle(repoRoot, state, itemId, runtime, now);
    errors.push(...outcome.errors);
  }
  return errors;
}

/** PATCH /api/skills - useGlobal | per-skill значение по умолчанию | override рантайма.
 *  Порядок: мутация состояния → запись файла (saveState) → хуки включения/выключения
 *  (симлинки в обязательной папке + команды манифеста) → ответ клиенту. */
export async function PATCH(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { level?: "useGlobal" | "default" | "runtime"; enabled?: boolean; itemId?: string; runtime?: string }
    | null;
  const { level, enabled } = body ?? {};
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "нужен enabled: boolean" }, { status: 400 });
  }
  const { ADAPTER_IDS: runtimeIds } = await import("@/runtimes");
  let hookErrors: string[] = [];
  if (level === "useGlobal") {
    setUseGlobalSkills(ctx.state, enabled);
  } else if (level === "default") {
    const { itemId } = body ?? {};
    if (!itemId) {
      return NextResponse.json({ error: "level=default требует itemId" }, { status: 400 });
    }
    const before = new Set(runtimeIds.filter((runtime) => skillEffective(ctx.state, itemId, runtime)));
    setSkillDefault(ctx.state, itemId, enabled);
    await ctx.saveState();
    hookErrors = await applyDefaultToggleHooks(ctx.repoRoot, ctx.state, itemId, before);
  } else if (level === "runtime") {
    const { itemId, runtime } = body ?? {};
    if (!itemId || !runtime) {
      return NextResponse.json({ error: "level=runtime требует itemId и runtime" }, { status: 400 });
    }
    const before = skillEffective(ctx.state, itemId, runtime);
    setSkillRuntimeOverride(ctx.state, itemId, runtime, enabled);
    await ctx.saveState();
    if (before !== enabled) {
      const outcome = await applySkillToggle(ctx.repoRoot, ctx.state, itemId, runtime, enabled);
      hookErrors = outcome.errors;
    }
  } else {
    return NextResponse.json({ error: "level: useGlobal | default | runtime" }, { status: 400 });
  }
  await ctx.saveState();
  invalidateDashboardCache();
  // синк нативных команд (набор включённых master/design-навыков изменился)
  // и симлинков навыков (канон .agents/skills -> каталоги рантаймов)
  let commandSyncErrors: string[] = [];
  let linkErrors: string[] = [];
  try {
    const reports = await syncRuntimeCommands(ctx.repoRoot, ctx.state);
    commandSyncErrors = reports.filter((report) => report.error).map((report) => `${report.runtime}: ${report.error}`);
  } catch (error) {
    commandSyncErrors = [error instanceof Error ? error.message : String(error)];
  }
  try {
    const reports = await syncSkillLinks(ctx.repoRoot, ctx.state);
    linkErrors = reports.flatMap((report) => report.errors.map((message) => `${report.runtime}: ${message}`));
  } catch (error) {
    linkErrors = [error instanceof Error ? error.message : String(error)];
  }
  return NextResponse.json({
    ok: true,
    enabled,
    hookErrors: hookErrors.length ? hookErrors : undefined,
    commandSyncErrors: commandSyncErrors.length ? commandSyncErrors : undefined,
    linkErrors: linkErrors.length ? linkErrors : undefined,
  });
}
