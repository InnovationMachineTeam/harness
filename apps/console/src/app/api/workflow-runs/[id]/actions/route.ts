import { NextResponse } from "next/server";
import { resolveWorkflowWorkspace } from "@/core/workflows/http";
import { relaunchRunFromCatalog } from "@/core/workflows/relaunch";
import { WorkflowStore } from "@/core/workflows/storage";
import { ensureWorkflowWorker } from "@/core/workflows/worker";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";
const ACTIONS = new Set(["resume", "approve", "answer", "retry", "restart", "retry-from-success", "skip", "replace", "cancel", "abort", "confirm-plan", "accept", "rework-input", "answer-questions", "apply-lessons", "relaunch-current"]);

/** Ответы оператора на уточняющие вопросы из payload: пары вопрос-ответ без пустых полей. */
function answeredQuestions(value: unknown): Array<{ question: string; answer: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = (item ?? {}) as { question?: unknown; answer?: unknown };
    const question = String(record.question ?? "").trim();
    const answer = String(record.answer ?? "").trim();
    return question && answer ? [{ question, answer }] : [];
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await serverContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { workspace?: string; action?: string; payload?: Record<string, unknown> } | null;
  try {
    if (!body?.action || !ACTIONS.has(body.action)) throw new Error("неизвестное действие");
    if (["retry", "restart", "retry-from-success", "skip", "replace", "abort", "relaunch-current"].includes(body.action) && !String(body.payload?.reason ?? "").trim()) throw new Error("для действия обязательна причина");
    const workspace = resolveWorkflowWorkspace(ctx.state, body.workspace);
    const store = new WorkflowStore(ctx.repoRoot, workspace);
    const run = store.getRun(id);
    if (!run) {
      store.close();
      return NextResponse.json({ error: "run не найден" }, { status: 404 });
    }
    let type = body.action;
    let payload = body.payload ?? {};
    if (body.action === "approve") {
      type = "resume";
      payload = { action: "approve", ...payload };
    } else if (body.action === "answer") {
      type = "resume";
      payload = { resolved: true, ...payload };
    } else if (body.action === "confirm-plan") {
      const decision = String(body.payload?.decision ?? "");
      if (!["approve", "reject"].includes(decision)) throw new Error("confirm-plan требует decision: approve | reject");
      const questions = answeredQuestions(body.payload?.questions);
      if (decision === "reject" && !String(body.payload?.comment ?? "").trim() && !questions.length) throw new Error("отклонение плана требует комментарий или ответы на вопросы");
      type = "resume";
      payload = { action: decision, comment: String(body.payload?.comment ?? ""), questions };
    } else if (body.action === "accept") {
      const decision = String(body.payload?.decision ?? "");
      if (!["approve", "reject", "defer"].includes(decision)) throw new Error("accept требует decision: approve | reject | defer");
      const questions = answeredQuestions(body.payload?.questions);
      if (decision === "reject" && !String(body.payload?.comment ?? "").trim() && !questions.length) throw new Error("отклонение приёмки требует комментарий или ответы на вопросы");
      type = "resume";
      payload = { action: decision, comment: String(body.payload?.comment ?? ""), questions };
    } else if (body.action === "rework-input") {
      if (!String(body.payload?.answer ?? "").trim()) throw new Error("rework-input требует answer");
      type = "resume";
      payload = { answer: String(body.payload?.answer) };
    } else if (body.action === "answer-questions") {
      const questions = Array.isArray(body.payload?.questions) ? body.payload?.questions : [];
      const qa = (questions as unknown[]).map((item) => {
        const record = (item ?? {}) as { question?: unknown; answer?: unknown };
        return { question: String(record.question ?? ""), answer: String(record.answer ?? "") };
      }).filter((item) => item.question.trim() && item.answer.trim());
      if (!String(body.payload?.answer ?? "").trim() && !qa.length) throw new Error("answer-questions требует answer или ответы на вопросы");
      type = "resume";
      payload = { answer: String(body.payload?.answer ?? ""), questions: qa };
    }
    if (body.action === "relaunch-current") {
      // Перезапуск действует немедленно: новый прогон из актуальной версии
      // workflow каталога; исходный прогон остаётся в своём терминальном статусе.
      const relaunched = await relaunchRunFromCatalog({ repoRoot: ctx.repoRoot, store, source: run, reason: String(payload.reason ?? "") });
      store.close();
      await ensureWorkflowWorker(ctx.repoRoot);
      return NextResponse.json({ ok: true, run: relaunched });
    }
    if (body.action === "retry" || body.action === "restart" || body.action === "retry-from-success") {
      if (["completed", "queued", "running"].includes(run.status)) throw new Error("действие недоступно для прогона в статусе " + run.status);
      store.updateRun(id, "queued", { error: null, finishedAt: null });
    }
    if (body.action === "cancel" || body.action === "abort") {
      // Отмена действует немедленно: статус меняется до очереди, чтобы выполняемые
      // секции остановились на следующей проверке (waitForProcess, раунд цикла).
      // Команда в очереди остаётся идемпотентным закрытием на случай паузы.
      store.updateRun(id, "cancelled", { finishedAt: new Date().toISOString(), error: String(payload.reason ?? "отменён") });
      store.appendEvent(id, "run.cancelled", { reason: payload.reason ?? null, immediate: true });
    }
    store.enqueueCommand(id, type, payload);
    store.appendEvent(id, "run.action", { action: body.action, payload });
    store.close();
    await ensureWorkflowWorker(ctx.repoRoot);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
