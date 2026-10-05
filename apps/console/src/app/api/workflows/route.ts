import path from "node:path";
import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import YAML from "yaml";
import { syncRuntimeCommands } from "@/core/commandSync";
import { loadWorkflowCatalog, parseWorkflowYaml, renameWorkflowRefs, saveWorkflowYaml } from "@/core/workflows/catalog";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { serverContext } from "@/lib/server-context";
import type { ConsoleState } from "@/core/state";

export const dynamic = "force-dynamic";

/** Синк нативных команд после изменения каталога workflow (best-effort). */
async function syncCommands(repoRoot: string, state: ConsoleState): Promise<string[]> {
  try {
    const reports = await syncRuntimeCommands(repoRoot, state);
    return reports.filter((report) => report.error).map((report) => `${report.runtime}: ${report.error}`);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

export async function GET(request: Request) {
  const ctx = await serverContext();
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    const catalog = await loadWorkflowCatalog(ctx.repoRoot, workspace);
    return NextResponse.json({
      workspace,
      workflows: [...catalog.values()].map((entry) => ({
        ...entry.value,
        etag: entry.etag,
        yaml: entry.yaml,
        sourceFile: entry.sourceFile,
        scope: entry.scope,
        fileName: path.basename(entry.sourceFile),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as {
    action?: string;
    workspace?: string;
    yaml?: string;
    fileName?: string;
    etag?: string;
    sourceId?: string;
    newId?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "неверное тело запроса" }, { status: 400 });
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, body.workspace);
    if (body.action === "validate") return NextResponse.json(parseWorkflowYaml(body.yaml ?? ""));
    if (body.action === "save") {
      const fileName = body.fileName ?? "workflow.yaml";
      const parsed = parseWorkflowYaml(body.yaml ?? "");
      if (!parsed.ok || !parsed.workflow) throw new Error(parsed.errors.join("; "));
      const newId = parsed.workflow.id;
      let entries: Array<{ value: { id: string }; sourceFile: string }> = [];
      try {
        entries = [...(await loadWorkflowCatalog(ctx.repoRoot, workspace)).values()];
      } catch {
        entries = [];
      }
      const existing = entries.find((entry) => path.basename(entry.sourceFile) === fileName);
      const renamed = Boolean(existing && existing.value.id !== newId);
      if (!existing || renamed) {
        // Уникальность id во всей системе: другой файл с таким id запрещён.
        const clash = entries.find((entry) => entry.value.id === newId && path.basename(entry.sourceFile) !== fileName);
        if (clash) throw new Error(`id ${newId} уже используется в ${path.basename(clash.sourceFile)}`);
      }
      if (renamed) {
        const oldId = existing!.value.id;
        const newFileName = newId.replace(/:/g, ".") + ".yaml";
        const saved = await saveWorkflowYaml({ root: workspace, fileName: newFileName, yaml: body.yaml ?? "" });
        await renameWorkflowRefs({ harnessRoot: ctx.repoRoot, workspaceRoot: workspace, oldId, newId });
        await unlink(path.join(workspace, ".agents", "workflows", fileName)).catch(() => {});
        return NextResponse.json({ ok: true, workflow: saved.value, etag: saved.etag, yaml: saved.yaml, fileName: newFileName, renamed: true, commandSyncErrors: await syncCommands(ctx.repoRoot, ctx.state) });
      }
      const saved = await saveWorkflowYaml({ root: workspace, fileName, yaml: body.yaml ?? "", expectedEtag: body.etag });
      return NextResponse.json({ ok: true, workflow: saved.value, etag: saved.etag, yaml: saved.yaml, commandSyncErrors: await syncCommands(ctx.repoRoot, ctx.state) });
    }
    if (body.action === "clone") {
      if (!body.sourceId || !body.newId) throw new Error("sourceId и newId обязательны");
      const catalog = await loadWorkflowCatalog(ctx.repoRoot, workspace);
      const source = catalog.get(body.sourceId);
      if (!source) throw new Error("исходный workflow не найден");
      if (catalog.has(body.newId)) throw new Error("workflow с таким ID уже существует");
      const fileName = body.fileName ?? body.newId.replace(/:/g, ".") + ".yaml";
      const yaml = YAML.stringify({
        apiVersion: "harness/v1",
        kind: "Workflow",
        id: body.newId,
        title: source.value.title + " - копия",
        description: `Наследуется от ${body.sourceId}.`,
        extends: body.sourceId,
        inputs: {},
        defaults: source.value.defaults,
        nodes: [],
      }, { lineWidth: 0 });
      const saved = await saveWorkflowYaml({ root: workspace, fileName, yaml });
      return NextResponse.json({ ok: true, workflow: saved.value, etag: saved.etag, yaml: saved.yaml, commandSyncErrors: await syncCommands(ctx.repoRoot, ctx.state) }, { status: 201 });
    }
    return NextResponse.json({ error: "неизвестное действие" }, { status: 400 });
  } catch (error) {
    const typed = error as Error & { code?: string; current?: string; etag?: string };
    return NextResponse.json(
      { error: typed.message, code: typed.code, current: typed.current, etag: typed.etag },
      { status: typed.code === "ETAG_CONFLICT" ? 409 : 400 },
    );
  }
}
