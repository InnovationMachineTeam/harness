import { NextResponse } from "next/server";
import { homedir } from "node:os";
import { collectUnifiedSkills } from "@/core/skillRegistry";
import { mandatoryWorkspace } from "@/core/state";
import { workspaceDirs } from "@/core/state";
import { fsSignals } from "@/lib/signals/fs";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/skills/all - единый список навыков для вкладок "Навыки" (настройки
 * и пространство рантайма): все лейблы (internal/runtime/skills.sh/plugin/
 * workflow) одним списком, бейджи рантаймов (installed/effective из overlay
 * тогглов), флаги toggleable и хуки манифеста. Симлинк-детекция и все операции
 * хуков выполняются в обязательной рабочей папке.
 */
export async function GET() {
  const ctx = await serverContext();
  const probeCtx = { repoRoot: ctx.repoRoot, home: homedir(), fs: fsSignals, workspaces: workspaceDirs(ctx.state) };
  const items = await collectUnifiedSkills(probeCtx, ctx.state);
  return NextResponse.json({
    useGlobal: ctx.state.skills.useGlobal,
    mandatoryWorkspace: mandatoryWorkspace(ctx.state),
    items,
  });
}
