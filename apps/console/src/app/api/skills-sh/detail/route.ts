import { NextResponse } from "next/server";
import { skillDetail } from "@/core/skillsSh";

export const dynamic = "force-dynamic";

/** GET /api/skills-sh/detail?id=<owner/repo/skill> - описание + аудит. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9@/._-]{0,120}$/.test(id)) {
    return NextResponse.json({ error: "некорректный id" }, { status: 400 });
  }
  const detail = await skillDetail(id);
  return NextResponse.json({ detail });
}
