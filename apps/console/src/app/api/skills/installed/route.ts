import { NextResponse } from "next/server";
import { collectHarnessSkills, skillDefault } from "@/core/skills";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET /api/skills/installed - установленные harness-навыки (.agents/skills)
 *  с их per-skill значением по умолчанию (toggle на странице "Навыки"). */
export async function GET() {
  const ctx = await serverContext();
  const { homedir } = await import("node:os");
  const { workspaceDirs } = await import("@/core/state");
  const { fsSignals } = await import("@/lib/signals/fs");
  const items = await collectHarnessSkills({
    repoRoot: ctx.repoRoot,
    home: homedir(),
    fs: fsSignals,
    workspaces: workspaceDirs(ctx.state),
  });
  return NextResponse.json({
    items: items.map((item) => ({ ...item, defaultEnabled: skillDefault(ctx.state, item.id) })),
  });
}
