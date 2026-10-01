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
import { invalidateDashboardCache } from "@/core/cache";
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

/** PATCH /api/skills - useGlobal | per-skill значение по умолчанию | override рантайма.
 *  Порядок: мутация состояния → запись файла (saveState) → ответ клиенту
 *  (клиент обновляет store только после успешной записи). */
export async function PATCH(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { level?: "useGlobal" | "default" | "runtime"; enabled?: boolean; itemId?: string; runtime?: string }
    | null;
  const { level, enabled } = body ?? {};
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "нужен enabled: boolean" }, { status: 400 });
  }
  if (level === "useGlobal") {
    setUseGlobalSkills(ctx.state, enabled);
  } else if (level === "default") {
    const { itemId } = body ?? {};
    if (!itemId) {
      return NextResponse.json({ error: "level=default требует itemId" }, { status: 400 });
    }
    setSkillDefault(ctx.state, itemId, enabled);
  } else if (level === "runtime") {
    const { itemId, runtime } = body ?? {};
    if (!itemId || !runtime) {
      return NextResponse.json({ error: "level=runtime требует itemId и runtime" }, { status: 400 });
    }
    setSkillRuntimeOverride(ctx.state, itemId, runtime, enabled);
  } else {
    return NextResponse.json({ error: "level: useGlobal | default | runtime" }, { status: 400 });
  }
  await ctx.saveState();
  invalidateDashboardCache();
  return NextResponse.json({ ok: true, enabled });
}
