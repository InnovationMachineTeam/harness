import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Группа catalog: рабочие папки и их каталоги - роли, навыки, slash-меню. */
export function buildCatalogTools(actions: HarnessMcpActions): ToolSpec[] {
  return [
    {
      name: "list_workspaces",
      description: "Рабочие папки консоли: путь, режим (write - обязательная, read - дополнительная) и признак экспозиции этим MCP-сервером.",
      schema: {},
      handler: () => actions.listWorkspaces(),
    },
    {
      name: "list_roles",
      description: "Роли-агенты (.agents/roles): идентификатор, заголовок, домен, навыки, признак субагента. Идентификатор используется в /agent:<id>.",
      schema: {
        filter: z.string().optional().describe("подстрока для фильтра по идентификатору или заголовку"),
      },
      handler: (args) => actions.listRoles(args),
    },
    {
      name: "list_skills",
      description: "Internal-навыки мастер-каталога (master и design): идентификатор, заголовок, описание, теги. Вызов в чате консоли - /master:<id>.",
      schema: {},
      handler: () => actions.listSkills(),
    },
    {
      name: "slash_menu",
      description: "Меню slash-команд исполнителя: навыки рантайма, публичные и internal-навыки, роли, workflow рабочей папки.",
      schema: {
        executor: z.string().min(1).describe("исполнитель: id рантайма, provider или provider:<id>"),
        workflowId: z.string().optional().describe("workflow-режим: навыки ролей выбранного workflow (по умолчанию direct)"),
        workspace: z.string().optional().describe("рабочая папка; по умолчанию первая экспонируемая"),
      },
      handler: (args) => actions.slashMenu(args),
    },
  ];
}
