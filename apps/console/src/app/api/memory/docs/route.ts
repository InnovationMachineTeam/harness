import path from "node:path";
import { NextResponse } from "next/server";
import { buildNavTree, collectDocFiles } from "@/core/memory";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/docs - деревья markdown-документов по рабочим папкам
 * (только включённые тогглом Docs: state.workspaces.docs).
 */
export async function GET() {
  const { state } = await serverContext();
  const folders = await Promise.all(
    workspaceDirs(state).map(async (dir) => {
      const files = await collectDocFiles(fsSignals, dir);
      return {
        dir,
        name: path.basename(dir),
        enabled: state.workspaces.docs.includes(dir),
        count: files.length,
        tree: buildNavTree(dir, files),
      };
    }),
  );
  return NextResponse.json({ folders });
}
