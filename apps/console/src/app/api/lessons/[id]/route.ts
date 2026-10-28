import { NextResponse } from "next/server";
import { listLessons, setLessonStatus } from "@/core/lessonsLibrary";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * POST /api/lessons/<id> {status: adopted|rejected, statement?} - решение
 * оператора по уроку. Принятые уроки движок workflow внедряет в задания секций.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: string; statement?: unknown } | null;
  if (body?.status !== "adopted" && body?.status !== "rejected") {
    return NextResponse.json({ error: "нужен status: adopted | rejected" }, { status: 400 });
  }
  const statement = typeof body.statement === "string" ? body.statement : undefined;
  const lesson = await setLessonStatus(ctx.repoRoot, id, body.status, { statement });
  if (!lesson) {
    return NextResponse.json({ error: "урок не найден в библиотеке" }, { status: 404 });
  }
  const lessons = await listLessons(ctx.repoRoot);
  return NextResponse.json({ ok: true, lesson, total: lessons.length });
}
