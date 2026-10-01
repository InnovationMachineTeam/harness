import { NextResponse } from "next/server";
import { mcpPresetsForPm } from "@/core/plugins";
import { readPackageManagerPref } from "@/core/tools";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/mcp/catalog - пресет-каталог MCP (npx-пресеты адаптированы под выбранный менеджер). */
export async function GET() {
  const { repoRoot } = await serverContext();
  const pm = await readPackageManagerPref(repoRoot);
  return NextResponse.json({ presets: mcpPresetsForPm(pm), packageManager: pm });
}
