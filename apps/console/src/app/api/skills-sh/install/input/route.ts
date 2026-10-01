import { NextResponse } from "next/server";
import { getJob, writeJobInput } from "@/core/installJobs";

export const dynamic = "force-dynamic";

/** POST /api/skills-sh/install/input {jobId, text} - ввод в stdin установки. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { jobId?: string; text?: string } | null;
  const { jobId, text } = body ?? {};
  if (!jobId || typeof text !== "string") {
    return NextResponse.json({ error: "нужны jobId и text" }, { status: 400 });
  }
  if (!getJob(jobId)) return NextResponse.json({ error: "job не найден" }, { status: 404 });
  if (text.includes("\0")) return NextResponse.json({ error: "недопустимые символы" }, { status: 400 });
  const ok = writeJobInput(jobId, text.slice(0, 2_000));
  return NextResponse.json({ ok });
}
