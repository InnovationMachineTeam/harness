import { NextResponse } from "next/server";
import { writeToolsEnv } from "@/core/tools";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/setup/complete - завершение Setup Wizard: {skipped?: boolean}.
 * Пишет setupWizard.done=true в state.json (gate консоли снимается) и
 * обновляет tools.env для диспетчера tool.sh.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { skipped?: unknown } | null;
  const skipped = body?.skipped === true;
  const now = new Date().toISOString();
  ctx.state.setupWizard = {
    done: true,
    completedAt: skipped ? null : now,
    skippedAt: skipped ? now : null,
  };
  await ctx.saveState();
  await writeToolsEnv(ctx.repoRoot, ctx.state);
  return NextResponse.json({ ok: true });
}
