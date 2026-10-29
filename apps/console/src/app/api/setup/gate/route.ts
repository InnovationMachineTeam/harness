import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import { ensureSetupStarted, setupGateRequired } from "@/core/setupWizard";
import { loadConsoleState } from "@/core/state";

export const dynamic = "force-dynamic";

/**
 * GET /api/setup/gate - лёгкая проверка для SetupGate (layout): нужна ли
 * первичная установка. На новой установке здесь же фиксируется начало
 * визарда (state.json с setupWizard.done=false) - до первых сохранений
 * состояния другими разделами. Полный статус - GET /api/setup/status.
 */
export async function GET() {
  const repoRoot = findRepoRoot();
  const required = setupGateRequired(repoRoot);
  if (required) {
    const state = await loadConsoleState(repoRoot);
    await ensureSetupStarted(repoRoot, state);
  }
  return NextResponse.json({ required });
}
