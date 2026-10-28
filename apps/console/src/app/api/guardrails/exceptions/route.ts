import { NextResponse } from "next/server";
import { loadExceptions, nextExceptionId, removeException, saveException } from "@harness/guardrails";
import { findRepoRoot } from "@/core/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/guardrails/exceptions - активные, просроченные и битые исключения политики. */
export function GET() {
  const repoRoot = findRepoRoot();
  try {
    const result = loadExceptions(repoRoot);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/**
 * POST /api/guardrails/exceptions - создание исключения из консоли (решение
 * человека: "разрешить один раз" - singleUse, "разрешать всегда" - шаблон
 * области и срок). Имя файла генерирует nextExceptionId; содержимое идентично
 * CLI-команде approve.
 */
export async function POST(request: Request) {
  const repoRoot = findRepoRoot();
  const body = await request.json().catch(() => null) as {
    ruleId?: string;
    reason?: string;
    days?: number;
    singleUse?: boolean;
    scope?: { tools?: string[]; pathPattern?: string; commandPattern?: string };
  } | null;
  try {
    const ruleId = body?.ruleId?.trim() ?? "";
    const reason = body?.reason?.trim() ?? "";
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(ruleId)) throw new Error("ruleId задан некорректно");
    if (!reason) throw new Error("reason обязателен - причина решения человека");
    const singleUse = body?.singleUse === true;
    const days = Number.isInteger(body?.days) && (body?.days as number) >= 1 && (body?.days as number) <= 365
      ? (body?.days as number)
      : singleUse ? 1 : 7;
    const scope: { tools?: string[]; pathPattern?: string; commandPattern?: string } = {};
    const tools = (body?.scope?.tools ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 10);
    if (tools.length) scope.tools = tools;
    for (const key of ["pathPattern", "commandPattern"] as const) {
      const pattern = body?.scope?.[key]?.trim();
      if (!pattern) continue;
      new RegExp(pattern, "i");
      scope[key] = pattern.slice(0, 300);
    }
    const exception = {
      id: nextExceptionId(repoRoot),
      ruleId,
      reason: reason.slice(0, 500),
      approvedBy: "console",
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60_000).toISOString(),
      singleUse: singleUse || undefined,
      scope: Object.keys(scope).length ? scope : undefined,
    };
    const file = saveException(repoRoot, exception);
    return NextResponse.json({ exception, file }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/** DELETE /api/guardrails/exceptions?id= - отзыв исключения (удаление файла). */
export async function DELETE(request: Request) {
  const repoRoot = findRepoRoot();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    if (!removeException(repoRoot, id)) throw new Error("исключение не найдено: " + id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
