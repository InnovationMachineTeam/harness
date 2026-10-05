import { NextResponse } from "next/server";
import path from "node:path";
import { parseDesignRunTarget, runDesignTask } from "@/core/design/run";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/design/run {dir, prompt, target}
 * Единый запуск дизайн-задачи: target runtime (headless claude/opencode,
 * новая сессия с cwd = рабочая папка), provider (агентный цикл в процессе
 * консоли с MCP open-design/figma) или session (headless-resume отдельно
 * запущенной сессии). dir - папка из рабочих папок консоли.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { dir?: unknown; prompt?: unknown; target?: unknown } | null;
  if (!body || typeof body.dir !== "string" || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "нужны dir и prompt" }, { status: 400 });
  }
  if (body.prompt.length > 32_000) {
    return NextResponse.json({ error: "промт длиннее 32 000 символов" }, { status: 400 });
  }
  const dir = path.resolve(body.dir);
  if (!workspaceDirs(ctx.state).includes(dir)) {
    return NextResponse.json({ error: "папка не входит в рабочие папки консоли" }, { status: 400 });
  }
  const target = parseDesignRunTarget(body.target);
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }
  const result = await runDesignTask({
    repoRoot: ctx.repoRoot,
    state: ctx.state,
    dir,
    prompt: body.prompt,
    target,
    adapters: ctx.adapters,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
