import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * Каталог json-render для вкладки "Агент": набор компонентов, которые
 * LLM-провайдер может собрать в UI-спеку внутри ответа. catalog.prompt()
 * (mode "inline") идёт в system-промт маршрута /api/agent/chat; текст ответа
 * и JSONL-патчи спеки едут одним текстовым стримом (протокол createMixedStreamParser).
 * Реестр React-компонентов - lib/json-render/registry.tsx.
 */
export const catalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({
        title: z.string().nullable().describe("заголовок карточки"),
        description: z.string().nullable().describe("короткое описание под заголовком"),
      }),
      slots: ["default"],
      description: "Контейнер-карточка; содержимое передаётся дочерними элементами.",
    },
    Heading: {
      props: z.object({
        text: z.string().describe("текст заголовка"),
        level: z.enum(["h2", "h3", "h4"]).nullable().describe("уровень, по умолчанию h3"),
      }),
      description: "Заголовок раздела внутри ответа.",
    },
    Text: {
      props: z.object({
        content: z.string().describe("абзац текста"),
      }),
      description: "Абзац текста.",
    },
    List: {
      props: z.object({
        items: z.array(z.string()).describe("пункты списка"),
        ordered: z.boolean().nullable().describe("true - нумерованный список"),
      }),
      description: "Список пунктов.",
    },
    Table: {
      props: z.object({
        columns: z.array(z.string()).describe("заголовки колонок"),
        rows: z.array(z.array(z.string())).describe("строки значений, длина строки равна числу колонок"),
      }),
      description: "Таблица с заголовками колонок.",
    },
    Metric: {
      props: z.object({
        label: z.string().describe("подпись показателя"),
        value: z.string().describe("значение показателя"),
        hint: z.string().nullable().describe("пояснение под значением"),
      }),
      description: "Отдельный числовой или текстовый показатель.",
    },
  },
  actions: {},
});
