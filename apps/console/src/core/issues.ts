import type { RuntimeVendorConfig } from "./registry";
import type { ConsoleState } from "./state";
import type { Issue } from "./types";

/**
 * Общие проверки диагностики, не зависящие от конкретного адаптера:
 * неподтверждённый маппинг моделей и ошибки последнего MCP-синка.
 */
export function sharedIssues(vendor: RuntimeVendorConfig, state: ConsoleState): Issue[] {
  const issues: Issue[] = [];

  const models = Object.values(vendor.models ?? {});
  const verified = models.filter((m) => m.verified === true).length;
  if (models.length > 0 && verified < models.length) {
    issues.push({
      severity: "warn",
      title: `Модели не подтверждены (${verified}/${models.length})`,
      detail: "Часть маппингов tier→модель имеет verified:false - подтвердите фактические модели у пользователя и впишите в конфиг",
      hint: "AGENTS.md §4: неподтверждённые значения согласуются с пользователем на первом запуске рантайма",
    });
  }

  for (const result of Object.values(state.lastMcpSync)) {
    if (!result.ok) {
      issues.push({
        severity: "error",
        title: `MCP-синк не удался: ${result.label}`,
        detail: result.error,
        hint: "Проверьте файл таргета вручную; повторите синк на вкладке \"Навыки и MCP\"",
      });
    }
  }

  return issues;
}

/** Проверка файла адаптера хуков: существует и ведёт в guard с нужным AGENT_RUNTIME. */
export async function hookFileIssue(
  readText: (p: string, max?: number) => Promise<string | null>,
  file: string,
  runtimeId: string,
  extra?: { expectIncludes?: string[]; note?: string },
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const text = await readText(file, 16_000);
  if (text === null) {
    return [
      {
        severity: "error",
        title: `Файл адаптера хуков не найден: ${file}`,
        hint: "Рантайм работает без guard-политики репозитория",
      },
    ];
  }
  if (!text.includes("guard.mjs")) {
    issues.push({
      severity: "error",
      title: `Хук не ведёт в guard: ${file}`,
      detail: "В файле адаптера нет ссылки на .agents/runtime/guard.mjs",
    });
  }
  if (!text.includes(`AGENT_RUNTIME=${runtimeId}`)) {
    issues.push({
      severity: "warn",
      title: `Хук не задаёт AGENT_RUNTIME=${runtimeId}`,
      detail: "Guard не сможет загрузить конфиг этого рантайма",
    });
  }
  for (const needle of extra?.expectIncludes ?? []) {
    if (!text.includes(needle)) {
      issues.push({
        severity: "warn",
        title: `В адаптере отсутствует ${needle}`,
        detail: file,
      });
    }
  }
  return issues;
}
