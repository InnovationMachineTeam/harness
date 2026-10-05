import { NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import path from "node:path";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** GET: детали шага не здесь - это обзор прогона: run, события, попытки, артефакты, lessons. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const run = store.getRun(id);
    const events = run ? store.listEvents(id, 0, 1000) : [];
    const attempts = run ? store.listAttempts(id) : [];
    const artifacts = run ? store.listArtifacts(id) : [];
    const lessonsArtifact = run ? store.latestArtifact(id, "lessons", "__lessons-proposals") : null;
    let lessons: unknown = null;
    if (lessonsArtifact) {
      try { lessons = JSON.parse(lessonsArtifact.content || "[]"); } catch { lessons = []; }
    }
    store.close();
    return run ? NextResponse.json({ run, events, attempts, artifacts, lessons }) : NextResponse.json({ error: "run не найден" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

/** DELETE: полное удаление завершённого прогона - журнал, попытки, артефакты, чекпоинты, папка задачи. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const run = store.getRun(id);
    if (!run) {
      store.close();
      return NextResponse.json({ error: "run не найден" }, { status: 404 });
    }
    if (["queued", "running", "waiting"].includes(run.status)) {
      store.close();
      return NextResponse.json({ error: `активный прогон (${run.status}) нельзя удалить - сначала abort` }, { status: 409 });
    }
    store.deleteRun(id);
    store.close();
    // Поставка прогона: .agents/console/tasks/<run-id> (новый корень) и legacy .agents/tasks/<run-id>.
    for (const taskDir of [path.join(ctx.repoRoot, ".agents", "console", "tasks", id), path.join(run.workspaceDir, ".agents", "tasks", id)]) {
      await rm(taskDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
