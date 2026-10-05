import { NextResponse } from "next/server";
import { TOOLS } from "@/core/tools";

export const dynamic = "force-dynamic";

/** GET /api/tools/ids - идентификаторы и названия реестра инструментов; без detекта и побочных эффектов. */
export function GET() {
  return NextResponse.json({ tools: TOOLS.map((tool) => ({ id: tool.id, title: tool.title })) });
}
