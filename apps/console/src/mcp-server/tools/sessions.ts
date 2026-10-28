import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Группа sessions: сессии рантаймов - список, полнотекстовый поиск, ответ в сессию. */
export function buildSessionTools(actions: HarnessMcpActions): ToolSpec[] {
  return [
    {
      name: "list_sessions",
      description: "Сессии рантаймов (объединённый список по свежести): идентификатор, рантайм, папка, время активности, метрики.",
      schema: {
        runtime: z.string().optional().describe("один рантайм или список через запятую; по умолчанию все"),
        dir: z.string().optional().describe("фильтр по рабочей папке"),
        limit: z.number().int().min(1).max(100).optional().describe("размер списка (по умолчанию 30)"),
      },
      handler: (args) => actions.listSessions(args),
    },
    {
      name: "search_sessions",
      description: "Полнотекстовый поиск по сообщениям сессий (индекс sessions.sqlite); при выключенной записи текстов - поиск по метаданным.",
      schema: {
        query: z.string().min(2).describe("поисковый запрос"),
        runtime: z.string().optional().describe("фильтр по рантайму"),
        dir: z.string().optional().describe("фильтр по рабочей папке"),
        limit: z.number().int().min(1).max(100).optional().describe("размер списка (по умолчанию 50)"),
      },
      handler: (args) => actions.searchSessions(args),
    },
    {
      name: "reply_session",
      description:
        "Ответить в существующую сессию рантайма (headless-resume). Ожидает завершения процесса ответа (до 120 секунд); вывод - последние строки.",
      schema: {
        runtime: z.string().min(1).describe("рантайм сессии"),
        sessionId: z.string().min(1).describe("идентификатор сессии"),
        text: z.string().min(1).describe("текст ответа"),
      },
      handler: (args) => actions.replySession(args),
    },
  ];
}
