import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Действия оператора над прогоном workflow (контракт /api/workflow-runs/[id]/actions). */
const WORKFLOW_ACTIONS = [
  "resume",
  "approve",
  "answer",
  "retry",
  "restart",
  "retry-from-success",
  "skip",
  "replace",
  "cancel",
  "abort",
  "confirm-plan",
  "accept",
  "rework-input",
  "answer-questions",
  "apply-lessons",
  "relaunch-current",
] as const;

/** Группа workflows: каталог, запуск, статусы, события и операторские действия прогонов. */
export function buildWorkflowTools(actions: HarnessMcpActions): ToolSpec[] {
  return [
    {
      name: "list_workflows",
      description: "Каталог workflow рабочей папки: идентификаторы, описания, шаги. Идентификатор используется для запуска.",
      schema: {
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.listWorkflows(args),
    },
    {
      name: "read_workflow",
      description: "YAML-определение workflow: шаги, роли, runtime-кандидаты, входы и выходы.",
      schema: {
        workflowId: z.string().min(1).describe("идентификатор workflow из list_workflows"),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.readWorkflow(args),
    },
    {
      name: "start_workflow",
      description:
        "Запустить прогон workflow: preflight-проверка, снимок ролей и навыков, постановка в очередь; исполнитель - фоновый воркер. " +
        "Возвращает запись прогона с его id.",
      schema: {
        workflowId: z.string().min(1).describe("идентификатор workflow из list_workflows"),
        input: z.record(z.string(), z.unknown()).optional().describe("входы прогона; главный запрос - поле request"),
        title: z.string().optional().describe("заголовок прогона; по умолчанию название workflow"),
        targetNodes: z.array(z.string()).optional().describe("подмножество шагов (остальные выполнятся как зависимости)"),
        startNodeId: z.string().optional().describe("диапазон шагов: от этого узла"),
        endNodeId: z.string().optional().describe("диапазон шагов: до этого узла"),
        forkFromRunId: z.string().optional().describe("создать ветку существующего прогона с его входами и снимком"),
        roadmapItemId: z.string().optional().describe("связать прогон с элементом roadmap"),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.startWorkflow(args),
    },
    {
      name: "workflow_status",
      description: "Статус прогона workflow: запись прогона без снимка и последние события.",
      schema: {
        runId: z.string().min(1).describe("идентификатор прогона"),
        workspace: z.string().optional().describe("рабочая папка прогона; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.workflowStatus(args),
    },
    {
      name: "workflow_events",
      description: "События журнала прогона workflow (порция от курсора after) и текущий статус.",
      schema: {
        runId: z.string().min(1).describe("идентификатор прогона"),
        after: z.number().int().min(0).optional().describe("курсор: id последнего полученного события; по умолчанию 0"),
        limit: z.number().int().min(1).max(200).optional().describe("размер порции (по умолчанию 50)"),
        workspace: z.string().optional().describe("рабочая папка прогона; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.workflowEvents(args),
    },
    {
      name: "workflow_action",
      description:
        "Операторское действие над прогоном: пауза/подтверждения (approve, confirm-plan, accept, answer, answer-questions, rework-input, resume) " +
        "и управление (retry, restart, retry-from-success, skip, replace, cancel, abort, apply-lessons, relaunch-current). " +
        "Для retry, restart, retry-from-success, skip, replace, abort, relaunch-current в payload обязателен reason.",
      schema: {
        runId: z.string().min(1).describe("идентификатор прогона"),
        action: z.enum(WORKFLOW_ACTIONS).describe("действие оператора"),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("данные действия: reason (причина), decision (approve | reject), answer, comment, questions"),
        workspace: z.string().optional().describe("рабочая папка прогона; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.workflowAction(args),
    },
  ];
}
