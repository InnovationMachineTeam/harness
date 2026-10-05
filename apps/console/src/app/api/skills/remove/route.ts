import { NextResponse } from "next/server";
import { syncRuntimeCommands } from "@/core/commandSync";
import { removeHarnessSkill } from "@/core/skillRemove";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** POST /api/skills/remove {name} - удалить установленный harness-навык. */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "нужен name" }, { status: 400 });

  const result = await removeHarnessSkill(ctx.repoRoot, name);
  // синк нативных команд: набор навыков изменился
  if (result.ok) {
    try {
      await syncRuntimeCommands(ctx.repoRoot, ctx.state);
    } catch {
      /* синк команд не блокирует удаление - статус покажет расхождение */
    }
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
