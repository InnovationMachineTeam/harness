import { NextResponse } from "next/server";
import { buildSprintWorkflow, createSprint, loadSprints } from "@/core/workflows/sprint";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { ensureWorkflowWorker } from "@/core/workflows/worker";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await serverContext();
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    return NextResponse.json({ workspace, sprints: await loadSprints(workspace) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as {
    workspace?: string;
    title?: string;
    rows?: Array<{ itemId: string; workflowId: string; bucket: number; order: number }>;
  } | null;
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, body?.workspace);
    const rows = (body?.rows ?? []).map((row) => ({ itemId: String(row.itemId), workflowId: String(row.workflowId), bucket: Math.max(1, Number(row.bucket) || 1), order: Math.max(0, Number(row.order) || 0) }));
    const sprint = await createSprint(workspace, { title: body?.title ?? "Спринт", rows });
    const workflow = buildSprintWorkflow(sprint);
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const run = store.createRun({
      workspaceDir: workspace,
      workflow,
      title: "Спринт: " + sprint.title,
      values: { sprint: { id: sprint.id, title: sprint.title, rows: sprint.rows } },
    });
    store.close();
    const worker = await ensureWorkflowWorker(ctx.repoRoot);
    return NextResponse.json({ sprint, run, worker }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
