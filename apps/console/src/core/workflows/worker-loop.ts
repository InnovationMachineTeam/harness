import { randomUUID } from "node:crypto";
import { loadConsoleState, workspaceDirs } from "../state";
import { executeWorkflowCommand } from "./engine";
import { WorkflowStore } from "./storage";

const POLL_MS = 500;
/** Интервал продления аренды (TTL аренды - 10 с). */
const HEARTBEAT_MS = 5000;
/** Потолок одновременных команд: команды одного прогона исполняются строго последовательно. */
const MAX_COMMANDS_IN_FLIGHT = 6;

export async function runWorkflowWorker(repoRoot: string): Promise<never> {
  const owner = "worker-" + process.pid + "-" + randomUUID().slice(0, 8);
  const stores = new Map<string, WorkflowStore>();
  let lastWorkspaceRefresh = 0;
  let stopped = false;
  /** Прогоны с исполняемой командой: команда ведёт граф до следующего окна или финала. */
  const inFlightRuns = new Set<string>();

  const stop = () => { stopped = true; };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // Аренда продлевается на весь срок жизни воркера: долгая команда не делает lease протухшим,
  // и второй воркер не помечает живой прогон прерванным и не исполняет его параллельно.
  const heartbeat = setInterval(() => {
    for (const store of stores.values()) store.heartbeatLease(owner);
  }, HEARTBEAT_MS);

  while (!stopped) {
    if (Date.now() - lastWorkspaceRefresh > 5_000) {
      const state = await loadConsoleState(repoRoot);
      for (const workspaceDir of workspaceDirs(state)) {
        if (!stores.has(workspaceDir)) stores.set(workspaceDir, new WorkflowStore(repoRoot, workspaceDir));
      }
      lastWorkspaceRefresh = Date.now();
    }

    for (const store of stores.values()) {
      if (!store.acquireLease(owner)) continue;
      for (const run of store.listRuns(200)) {
        if ((run.status === "queued" || run.status === "running") && !store.hasPendingCommand(run.id) && !inFlightRuns.has(run.id)) {
          if (run.status === "running") {
            store.updateRun(run.id, "interrupted", { error: "worker был перезапущен; run будет восстановлен из checkpoint" });
            store.appendEvent(run.id, "run.interrupted", { reason: "worker-restart" });
            // Попытки без финала - незавершённые секции умершего воркера: закрываем как failed.
            store.failStaleAttempts(run.id, "worker был перезапущен; результат попытки недостоверен");
          }
          store.enqueueCommand(run.id, run.status === "queued" ? "start" : "retry", {});
        }
      }
      // Команды разных прогонов исполняются параллельно - действия оператора не ждут
      // чужой длинной команды; команды одного прогона сериализуются по inFlightRuns.
      const capacity = MAX_COMMANDS_IN_FLIGHT - inFlightRuns.size;
      if (capacity <= 0) break;
      const commands = store.takeCommands(capacity, { excludeRunIds: inFlightRuns });
      for (const command of commands) {
        inFlightRuns.add(command.runId);
        void executeWorkflowCommand(repoRoot, store, command.runId, command)
          .catch((error) => {
            // Отказ выполнения команды не должен циклить прогон молча: фиксируем прерывание и пишем в журнал воркера.
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write("[worker] команда " + command.type + " для " + command.runId + " отклонена: " + message + "\n");
            try {
              store.updateRun(command.runId, "interrupted", { error: message });
              store.appendEvent(command.runId, "run.worker-error", { command: command.type, error: message });
            } catch {
              // База недоступна - журнал уже записал ошибку.
            }
          })
          .finally(() => inFlightRuns.delete(command.runId));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  clearInterval(heartbeat);
  for (const store of stores.values()) store.close();
  process.exit(0);
}
