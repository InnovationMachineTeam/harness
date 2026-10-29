import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import { writePackageManagerPref } from "@/core/tools";

export const dynamic = "force-dynamic";

/**
 * POST /api/setup/package-manager - выбор пакетного менеджера глобальных
 * npm-пакетов (шаг визарда): {packageManager: "bun" | "npm"}; пишется в
 * .agents/console/package-manager.json (общий с setup.sh).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { packageManager?: unknown } | null;
  const pm = body?.packageManager === "npm" ? "npm" : body?.packageManager === "bun" ? "bun" : null;
  if (!pm) {
    return NextResponse.json({ error: "packageManager: допустимы bun и npm" }, { status: 400 });
  }
  await writePackageManagerPref(findRepoRoot(), pm);
  return NextResponse.json({ ok: true, packageManager: pm });
}
