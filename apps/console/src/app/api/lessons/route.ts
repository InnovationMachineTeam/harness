import { NextResponse } from "next/server";
import { collectRunLessons, lessonDomainLabel, listLessons } from "@/core/lessonsLibrary";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/lessons - библиотека уроков (.agents/lessons): записи и счётчики по статусам. */
export async function GET() {
  const ctx = await serverContext();
  const lessons = await listLessons(ctx.repoRoot);
  return NextResponse.json({
    lessons: lessons.map((lesson) => ({ ...lesson, domainLabel: lessonDomainLabel(lesson.domain) })),
    counts: {
      proposed: lessons.filter((lesson) => lesson.status === "proposed").length,
      adopted: lessons.filter((lesson) => lesson.status === "adopted").length,
      rejected: lessons.filter((lesson) => lesson.status === "rejected").length,
    },
  });
}

/**
 * POST /api/lessons {action: "collect"} - агрегировать предложения из
 * lessons-артефактов прогонов и ретроспектив спринтов в библиотеку.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "collect") {
    return NextResponse.json({ error: "нужен action: collect" }, { status: 400 });
  }
  const result = await collectRunLessons(ctx.repoRoot);
  return NextResponse.json({ ok: true, ...result });
}
