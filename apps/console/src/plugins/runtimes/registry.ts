/**
 * Клиентский реестр рантаймов - плагинная система зеркала серверных адаптеров.
 *
 * Подключить новый runtime:
 *   1) сервер: .agents/runtime/<id>/config.json + адаптер в src/runtimes/
 *      (карточка, сигналы, сессии - см. README);
 *   2) клиент (опционально): файл src/plugins/runtimes/<id>.ts с UI-метаданными
 *      (монограмма/цвет) и одна строка в index.ts.
 * Без плагина рантайм всё равно работает - получает оформление по умолчанию.
 */

export interface RuntimePlugin {
  id: string;
  /** Отображаемое имя (если не задано - с сервера). */
  displayName?: string;
  monogram: string;
  /** Tailwind-классы рамки/фона/текста монограммы. */
  monogramClass: string;
}

const registry = new Map<string, RuntimePlugin>();

export function registerRuntimePlugin(plugin: RuntimePlugin): void {
  registry.set(plugin.id, plugin);
}

export function getRuntimePlugin(id: string): RuntimePlugin | undefined {
  return registry.get(id);
}

export const FALLBACK_PLUGIN: RuntimePlugin = {
  id: "_fallback",
  monogram: "?",
  monogramClass: "border-line-strong bg-raised text-fg-muted",
};

/** Метаданные для карточки/селекторов: плагин или значение по умолчанию. */
export function runtimePluginOrDefault(id: string): RuntimePlugin {
  return registry.get(id) ?? { ...FALLBACK_PLUGIN, id };
}
