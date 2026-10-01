import { NextResponse } from "next/server";
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
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
