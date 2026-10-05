import path from "node:path";
import { NextResponse } from "next/server";
import { buildNavTree, collectDocFiles, nestedWorkspaceExcluder } from "@/core/memory";
import { workspaceDirs } from "@/core/state";
import { serverContext } from "@/lib/server-context";
import { fsSignals } from "@/lib/signals/fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/docs - деревья markdown-документов по рабочим папкам
 * (только включённые тогглом Docs: state.workspaces.docs). Вложенные рабочие
 * папки исключаются из дерева родителя - они показываются собственной группой.
 */
export async function GET() {
  const { state } = await serverContext();
  const dirs = workspaceDirs(state);
  const folders = await Promise.all(
    dirs.map(async (dir) => {
      const exclude = nestedWorkspaceExcluder(dir, dirs);
      const files = await collectDocFiles(fsSignals, dir, exclude);
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
