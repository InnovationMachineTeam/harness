import { z } from "zod";
import type { HarnessMcpActions } from "../actions";
import type { ToolSpec } from "./types";

/** Группа prompts: запуск промтов в headless-сессиях рантаймов и провайдеров. */
export function buildPromptTools(actions: HarnessMcpActions): ToolSpec[] {
  return [
    {
      name: "run_prompt",
      description:
        "Запустить промт в новой headless-сессии: рантайм (claude, codex, zcode, cursor, kimi, opencode, antigravity) или провайдер (provider:<id>). " +
        "Возвращает лог-файл и PID; прогон идёт в фоновой сессии, результат - в логе и списке сессий.",
      schema: {
        prompt: z.string().min(1).describe("текст промта (до 32000 символов)"),
        runtime: z
          .string()
          .optional()
          .describe("id рантайма или provider:<id>; по умолчанию - настройка консоли 'Исполнение команд' или рантайм с отметкой ★"),
        workspace: z.string().optional().describe("рабочая папка запуска (cwd процесса); по умолчанию первая экспонируемая папка"),
      },
      handler: (args) => actions.runPrompt(args),
    },
  ];
}
