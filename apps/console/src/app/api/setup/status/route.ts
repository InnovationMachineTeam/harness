import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import {
  ensureSetupStarted,
  probeAgentRuntimes,
  probeSetupDeps,
  probeSystemInfo,
  probeSystemUtils,
  RECOMMENDED_TOOL_IDS,
  setupGateRequired,
} from "@/core/setupWizard";
import { detectToolCli, effectiveToolState, readPackageManagerPref, TOOLS } from "@/core/tools";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/setup/status - полный статус для Setup Wizard (/setup): gate,
 * система (ОС, brew/apt), зависимости (bun, node), системные утилиты, детект
 * рантаймов агентов, пакетный менеджер, зависимости воркспейса и список
 * инструментов для выбора. На новой установке фиксирует начало визарда
 * (state.json с setupWizard.done=false - см. core/setupWizard.ts).
 */
export async function GET() {
  const ctx = await serverContext();
  const fresh = await ensureSetupStarted(ctx.repoRoot, ctx.state);
  return NextResponse.json({
    required: setupGateRequired(ctx.repoRoot),
    fresh,
    wizard: ctx.state.setupWizard ?? null,
    system: probeSystemInfo(),
    deps: probeSetupDeps(),
    utils: probeSystemUtils(),
    runtimes: probeAgentRuntimes(),
    packageManager: await readPackageManagerPref(ctx.repoRoot),
    workspaceDepsInstalled: existsSync(join(ctx.repoRoot, "node_modules")),
    tools: TOOLS.map((def) => {
      const cli = detectToolCli(def.bin);
      return {
        id: def.id,
        title: def.title,
        description: def.description,
        category: def.category,
        docsUrl: def.docsUrl ?? null,
        binInstalled: cli.installed,
        binVersion: cli.version,
        state: effectiveToolState(def, ctx.state, homedir(), ctx.repoRoot),
        recommended: RECOMMENDED_TOOL_IDS.includes(def.id),
      };
    }),
  });
}
