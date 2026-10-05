import { NextResponse } from "next/server";
import { skillLinksStatus, syncSkillLinks } from "@/core/skillLinks";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/skills/links - статус симлинков навыков по рантаймам: что в каталогах
 * (симлинк/реальный каталог/битый), куда указывает, каких желаемых симлинков нет.
 */
export async function GET() {
  const ctx = await serverContext();
  const statuses = await skillLinksStatus(ctx.repoRoot, ctx.state);
  return NextResponse.json({ statuses });
}

/** POST /api/skills/links - синк: желаемые симлинки создаются, лишние управляемые убираются, реальные каталоги уходят в бэкап. */
export async function POST() {
  const ctx = await serverContext();
  const reports = await syncSkillLinks(ctx.repoRoot, ctx.state);
  const ok = reports.every((report) => !report.errors.length);
  return NextResponse.json({ reports, ok });
}
