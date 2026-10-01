import type { RuntimeAdapter } from "@/core/types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { kimiAdapter } from "./kimi";
import { opencodeAdapter } from "./opencode";
import { zcodeAdapter } from "./zcode";

/**
 * Единственная точка подключения адаптеров.
 *
 * Чтобы подключить новый runtime:
 *   1) добавь его конфиг в harness: .agents/runtime/<id>/config.json (если ещё нет) -
 *      карточка появится сама, без актуальных сигналов (статус "нет данных");
 *   2) для актуальных сигналов создай src/runtimes/<id>.ts с probeSignals/processPattern
 *      и допиши адаптер в список ниже.
 */
export const ADAPTERS: Record<string, RuntimeAdapter> = Object.fromEntries(
  [claudeAdapter, codexAdapter, zcodeAdapter, cursorAdapter, kimiAdapter, opencodeAdapter].map((a) => [a.id, a]),
);

export const ADAPTER_IDS = Object.keys(ADAPTERS);
