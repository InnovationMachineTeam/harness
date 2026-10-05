import { NextResponse } from "next/server";
import { listRoadmapItems, saveRoadmapItem } from "@/core/workflows/roadmap";
import { closeAgentPlaneTask } from "@/core/workflows/agentplane";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await serverContext();
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    return NextResponse.json({ workspace, items: await listRoadmapItems(workspace) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as { workspace?: string; item?: unknown } | null;
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, body?.workspace);
    const item = await saveRoadmapItem(workspace, body?.item);
    // Зеркало AgentsPlane: перевод задачи из workflow в done/archived закрывает задачу в AgentPlane (best-effort).
    let agentplane: unknown = undefined;
    if ((item.status === "done" || item.status === "archived") && item.workflowId) {
      agentplane = await closeAgentPlaneTask(item, workspace).catch(() => null);
    }
    return NextResponse.json({ item, agentplane });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
