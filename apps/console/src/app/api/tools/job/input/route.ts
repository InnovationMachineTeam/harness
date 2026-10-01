import { NextResponse } from "next/server";
import { writeToolJobInput } from "@/core/toolJobs";

export const dynamic = "force-dynamic";

/** POST /api/tools/job/input {jobId, text} - строка в stdin job'а (интерактивные установщики). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { jobId?: string; text?: string } | null;
  const jobId = body?.jobId ?? "";
  const text = (body?.text ?? "").slice(0, 500);
  if (!jobId || !text) return NextResponse.json({ error: "jobId и text обязательны" }, { status: 400 });
  const ok = writeToolJobInput(jobId, text);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
