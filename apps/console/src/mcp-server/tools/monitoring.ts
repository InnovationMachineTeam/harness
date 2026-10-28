import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { HarnessMcpConfig } from "../config";
import type { ToolSpec } from "./types";

/**
 * Группа monitoring: задачи и процессы консоли. stop_process включается только
 * явным флагом конфига monitoring.stopProcesses - остановка процесса по PID
 * деструктивна и по умолчанию скрыта.
 */
export function buildMonitoringTools(actions: HarnessMcpActions, config: HarnessMcpConfig): ToolSpec[] {
  const tools: ToolSpec[] = [
    {
      name: "list_tasks",
      description: "Реестр задач консоли: промты, рутины, сборки вики и графа - статусы, исполнители, лог-файлы.",
      schema: {},
      handler: () => actions.listTasks(),
    },
    {
      name: "list_processes",
      description: "Инвентаризация процессов (рантаймы, MCP-серверы, инструменты, провайдеры): PID, команда, время, признаки безопасности.",
      schema: {},
      handler: () => actions.listProcesses(),
    },
  ];
  if (config.monitoring.stopProcesses) {
    tools.push({
      name: "stop_process",
      description:
        "Остановить процесс консоли по PID (SIGTERM, при необходимости SIGKILL). Перед сигналом PID перепроверяется по инвентаризации. Действие деструктивно.",
      schema: {
        pid: z.number().int().positive().describe("PID процесса из list_processes"),
      },
      handler: (args) => actions.stopProcess(args),
    });
  }
  return tools;
}
