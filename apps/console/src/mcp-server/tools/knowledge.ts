import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Группа knowledge: библиотека уроков, roadmap, спринты, статистика, чтение файлов памяти. */
export function buildKnowledgeTools(actions: HarnessMcpActions): ToolSpec[] {
  return [
    {
      name: "list_lessons",
      description: "Библиотека уроков (.agents/lessons): накопленный опыт прогонов и спринтов по доменам.",
      schema: {},
      handler: () => actions.listLessons(),
    },
    {
      name: "roadmap",
      description: "Элементы roadmap рабочей папки (.agents/roadmap): темы, статусы, связки.",
      schema: {
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.listRoadmap(args),
    },
    {
      name: "list_sprints",
      description: "Спринты (.agents/sprints): статус, прогресс, связки с задачами.",
      schema: {},
      handler: () => actions.listSprints(),
    },
    {
      name: "stats",
      description: "Статистика задач, токенов и стоимости по дням.",
      schema: {
        days: z.number().int().min(1).max(90).optional().describe("глубина выборки в днях"),
      },
      handler: (args) => actions.stats(args),
    },
    {
      name: "read_file",
      description:
        "Прочитать markdown-файл из разрешённых корней памяти (доки рабочих папок, openwiki/, wiki Graphify). Произвольные пути и секреты запрещены.",
      schema: {
        path: z.string().min(1).describe("абсолютный путь к файлу"),
      },
      handler: (args) => actions.readFile(args),
    },
  ];
}
