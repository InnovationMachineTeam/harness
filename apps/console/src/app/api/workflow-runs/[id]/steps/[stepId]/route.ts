import { NextResponse } from "next/server";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { WorkflowStore } from "@/core/workflows/storage";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/**
 * Детали шага прогона: события, попытки и артефакты. Содержимое артефактов
 * выдаётся только при privacy "full" - в остальных режимах наружу идут
 * размер и контрольная сумма; события уже обезличены при записи.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const ctx = await serverContext();
  const { id, stepId } = await params;
  try {
    const workspace = resolveWorkflowWorkspace(ctx.state, new URL(request.url).searchParams.get("workspace"));
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const run = store.getRun(id);
    if (!run) {
      store.close();
      return NextResponse.json({ error: "run не найден" }, { status: 404 });
    }
    const step = run.snapshot.nodes.find((node) => node.id === stepId) ?? null;
    const events = store.listStepEvents(id, stepId);
    const attempts = store.listStepAttempts(id, stepId);
    const fullContent = run.privacy === "full";
    const artifacts = store.listStepArtifacts(id, stepId).map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      path: artifact.path,
      checksum: artifact.checksum,
      createdAt: artifact.createdAt,
      size: artifact.content ? Buffer.byteLength(artifact.content) : 0,
      content: fullContent ? artifact.content : null,
    }));
    const endState = store.stepEndStates(id).find((row) => row.stepId === stepId)?.type ?? null;
    store.close();
    return NextResponse.json({ run: { id: run.id, status: run.status, privacy: run.privacy, error: run.error }, step, endState, events, attempts, artifacts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
