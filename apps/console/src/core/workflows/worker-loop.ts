import { randomUUID } from "node:crypto";
import { loadConsoleState, workspaceDirs } from "../state";
import { executeWorkflowCommand } from "./engine";
import { WorkflowStore } from "./storage";

const POLL_MS = 500;

export async function runWorkflowWorker(repoRoot: string): Promise<never> {
  const owner = "worker-" + process.pid + "-" + randomUUID().slice(0, 8);
  const stores = new Map<string, WorkflowStore>();
  let lastWorkspaceRefresh = 0;
  let stopped = false;

  const stop = () => {
    stopped = true;
    for (const store of stores.values()) store.close();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopped) {
    if (Date.now() - lastWorkspaceRefresh > 5_000) {
      const state = await loadConsoleState(repoRoot);
      for (const workspaceDir of workspaceDirs(state)) {
        if (!stores.has(workspaceDir)) stores.set(workspaceDir, new WorkflowStore(repoRoot, workspaceDir));
      }
      lastWorkspaceRefresh = Date.now();
    }

    const work: Promise<void>[] = [];
    for (const store of stores.values()) {
      if (!store.acquireLease(owner)) continue;
      store.heartbeatLease(owner);
      for (const run of store.listRuns(200)) {
        if ((run.status === "queued" || run.status === "running") && !store.hasPendingCommand(run.id)) {
          if (run.status === "running") {
            store.updateRun(run.id, "interrupted", { error: "worker был перезапущен; run будет восстановлен из checkpoint" });
            store.appendEvent(run.id, "run.interrupted", { reason: "worker-restart" });
          }
          store.enqueueCommand(run.id, run.status === "queued" ? "start" : "retry", {});
        }
      }
      const commands = store.takeCommands(4);
      for (const command of commands) {
        work.push(executeWorkflowCommand(repoRoot, store, command.runId, command).catch((error) => {
          // Отказ выполнения команды не должен циклить прогон молча: фиксируем прерывание и пишем в журнал воркера.
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write("[worker] команда " + command.type + " для " + command.runId + " отклонена: " + message + "\n");
          try {
            store.updateRun(command.runId, "interrupted", { error: message });
            store.appendEvent(command.runId, "run.worker-error", { command: command.type, error: message });
          } catch {
            // База недоступна - журнал уже записал ошибку.
          }
        }));
      }
    }
    if (work.length) await Promise.allSettled(work);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  process.exit(0);
}
