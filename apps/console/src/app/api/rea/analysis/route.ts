import { open, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { findReaAnalysis } from "@/core/rea";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Лимит выдачи evidence-файла: больше - читается и отдаётся только лимит. */
const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * GET /api/rea/analysis?id=<id записи> - evidence-отчёт анализа или сборки
 * среды. Файл отдаётся только по записи реестра (произвольные пути исключены).
 */
export async function GET(request: Request) {
  const ctx = await serverContext();
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: "некорректный id записи" }, { status: 400 });
  }
  const analysis = await findReaAnalysis(ctx.repoRoot, id);
  if (!analysis) return NextResponse.json({ error: "запись не найдена" }, { status: 404 });
  if (!analysis.evidenceFile) {
    return NextResponse.json({ analysis, evidence: null });
  }
  let size: number;
  try {
    size = (await stat(analysis.evidenceFile)).size;
  } catch {
    return NextResponse.json({ analysis, evidence: null, note: "evidence-файл ещё не создан" });
  }
  const readSize = Math.min(size, EVIDENCE_MAX_BYTES);
  const handle = await open(analysis.evidenceFile, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, 0);
    return NextResponse.json({
      analysis,
      evidence: buffer.toString("utf8"),
      truncated: size > readSize,
      size,
    });
  } finally {
    await handle.close();
  }
}
