import { NextResponse } from "next/server";
import { mcpPresetsForPm } from "@/core/plugins";
import { readPackageManagerPref } from "@/core/tools";
import { serverContext } from "@/lib/server-context";
import { harnessMcpPreset } from "@/mcp-server/registry";

export const dynamic = "force-dynamic";

/** GET /api/mcp/catalog - пресет-каталог MCP (npx-пресеты адаптированы под выбранный менеджер; первый - собственный сервер harness). */
export async function GET() {
  const { repoRoot } = await serverContext();
  const pm = await readPackageManagerPref(repoRoot);
  return NextResponse.json({ presets: [harnessMcpPreset(repoRoot), ...mcpPresetsForPm(pm)], packageManager: pm });
}
