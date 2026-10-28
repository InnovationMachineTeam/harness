import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Группа routines: планировщик периодических запусков промта (интервал или cron). */
export function buildRoutineTools(actions: HarnessMcpActions): ToolSpec[] {
  return [
    {
      name: "list_routines",
      description: "Рутины рабочей папки, последние запуски и статус планировщика (воркера).",
      schema: {
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.listRoutines(args),
    },
    {
      name: "create_routine",
      description:
        "Создать рутину: периодический запуск промта исполнителем (рантайм или provider:<id>). " +
        "Расписание - интервал в минутах (от 15) или cron-выражение (не чаще 5 минут).",
      schema: {
        title: z.string().min(1).describe("заголовок рутины (до 200 символов)"),
        prompt: z.string().min(1).describe("промт запуска (до 32000 символов)"),
        executor: z.string().optional().describe("id рантайма или provider:<id>; по умолчанию - исполнитель рутины консоли"),
        intervalMin: z.number().int().min(15).max(10080).optional().describe("интервал в минутах (по умолчанию 60)"),
        scheduleType: z.enum(["interval", "cron"]).optional().describe("вид расписания; по умолчанию interval"),
        cronExpr: z.string().optional().describe("cron-выражение (обязателен при scheduleType=cron)"),
        enabled: z.boolean().optional().describe("включить сразу (по умолчанию true)"),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.createRoutine(args),
    },
    {
      name: "update_routine",
      description: "Изменить рутину: заголовок, промт, исполнителя, расписание или включение. Включение и смена расписания пересчитывают следующий запуск от текущего момента.",
      schema: {
        id: z.string().min(1).describe("идентификатор рутины"),
        title: z.string().optional(),
        prompt: z.string().optional(),
        executor: z.string().optional().describe("id рантайма или provider:<id>"),
        intervalMin: z.number().int().min(15).max(10080).optional(),
        scheduleType: z.enum(["interval", "cron"]).optional(),
        cronExpr: z.string().nullable().optional().describe("cron-выражение; null - убрать"),
        enabled: z.boolean().optional(),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.updateRoutine(args),
    },
    {
      name: "delete_routine",
      description: "Удалить рутину вместе с историей запусков.",
      schema: {
        id: z.string().min(1).describe("идентификатор рутины"),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.deleteRoutine(args),
    },
    {
      name: "run_routine_now",
      description: "Запросить внеплановый запуск рутины: исполнит планировщик на ближайшем тике, расписание не сдвигается.",
      schema: {
        id: z.string().min(1).describe("идентификатор рутины"),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.runRoutineNow(args),
    },
  ];
}
