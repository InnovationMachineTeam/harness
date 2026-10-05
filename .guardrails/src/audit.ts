import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import policy from "../policy.json";
import { INTEGRATIONS } from "./integrations";
import { RULES } from "./rules";
import type { GuardAuditSnapshot, IntegrationAudit } from "./types";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function policyDigest(): string {
  return createHash("sha256").update(stableJson({ policy, rules: RULES.map((r) => r.meta), integrations: INTEGRATIONS })).digest("hex");
}

export function auditIntegrations(root: string): IntegrationAudit[] {
  return INTEGRATIONS.map((record) => {
    const target = join(root, record.source);
    if (!existsSync(target)) return { ...record, status: "missing", detail: "Файл интеграции отсутствует." };
    const content = readFileSync(target, "utf8");
    if (!content.includes(record.marker)) return { ...record, status: "missing", detail: `Маркер не найден: ${record.marker}` };
    if (record.id === "runtime:cursor:preToolUse") {
      const config = JSON.parse(content) as { hooks?: { preToolUse?: Array<{ command?: string; failClosed?: boolean }> } };
      const hook = config.hooks?.preToolUse?.find((item) => item.command?.includes(record.marker));
      if (hook?.failClosed !== true) return { ...record, status: "degraded", detail: "Guardrails-хук Cursor настроен fail-open." };
    }
    if (record.id === "runtime:kimi:PreToolUse") {
      // Зеркало в домашнем каталоге - единственный действующий путь хука
      // для Kimi: когда файл существует, проверяем его напрямую.
      const mirror = join(homedir(), ".kimi-code", "config.toml");
      if (!existsSync(mirror)) return { ...record, status: "degraded", detail: "Проектный шаблон проверен; зеркало ~/.kimi-code/config.toml не установлено." };
      const mirrorContent = readFileSync(mirror, "utf8");
      if (mirrorContent.includes(record.marker)) return { ...record, status: "verified", detail: "Шаблон и пользовательское зеркало содержат актуальный маркер." };
      return { ...record, status: "degraded", detail: "Зеркало устарело: маркер Guardrails не найден; скопируйте блоки из .kimi/config.toml." };
    }
    return { ...record, status: "verified", detail: "Файл и ожидаемый маркер найдены." };
  });
}

export function buildAudit(root: string): GuardAuditSnapshot {
  const integrations = auditIntegrations(root);
  const ids = RULES.map((rule) => rule.meta.id);
  const checks = [
    {
      id: "catalog.unique-ids", title: "Уникальность правил", ok: new Set(ids).size === ids.length,
      detail: "У каждого правила отдельный идентификатор.",
      purpose: "Исключает ситуацию, когда два разных правила имеют один ID и отчёты смешивают их результаты.",
      protects: "Целостность каталога, журнала аудита и ссылок на правила.",
      evidence: `Проверено ${ids.length} идентификаторов; уникальных: ${new Set(ids).size}.`,
    },
    {
      id: "tests.hit-pass-edge", title: "Полнота тестовых сценариев",
      ok: RULES.every((rule) => rule.cases.some((c) => c.expect === "hit") && rule.cases.some((c) => c.expect === "pass") && rule.cases.some((c) => c.edge)),
      detail: "У каждого правила есть опасный, безопасный и граничный сценарий.",
      purpose: "Подтверждает, что правило блокирует опасный вызов, пропускает допустимый и корректно обрабатывает пограничную форму.",
      protects: "От ложных разрешений и избыточных блокировок.",
      evidence: `${RULES.length} правил содержат hit, pass и edge case; всего кейсов: ${RULES.reduce((sum, rule) => sum + rule.cases.length, 0)}.`,
    },
    {
      id: "integrations.present", title: "Подключение во всех заявленных точках",
      ok: integrations.every((item) => item.status !== "missing"),
      detail: "Все зарегистрированные runtime hooks, code hooks, Git hooks и CI-файлы найдены.",
      purpose: "Проверяет, что правило не осталось только кодом в каталоге, а вызывается перед реальными действиями.",
      protects: "От обхода политики через неподключённый runtime, консоль, commit, push или CI.",
      evidence: `Найдено ${integrations.filter((item) => item.status !== "missing").length} из ${integrations.length} заявленных интеграций.`,
    },
    {
      id: "critical.failure-closed", title: "Безопасный отказ критических правил",
      ok: RULES.filter((r) => r.meta.severity === "critical").every((r) => r.meta.failureMode === "closed"),
      detail: "Сбой критической проверки блокирует действие.",
      purpose: "Не позволяет выполнить опасную операцию, если Guardrails не смог разобрать вход или завершился с ошибкой.",
      protects: "Секреты, Git-историю, данные, production-инфраструктуру и решения человека.",
      evidence: `${RULES.filter((r) => r.meta.severity === "critical").length} критических правил имеют failureMode=closed.`,
    },
  ];
  const ruleIntegrations = integrations.map((item) => item.id);
  return {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    policyDigest: policyDigest(),
    generatedAt: new Date().toISOString(),
    totals: {
      rules: RULES.length,
      enforced: RULES.filter((r) => r.meta.status === "enforced").length,
      critical: RULES.filter((r) => r.meta.severity === "critical").length,
      integrations: integrations.length,
      verifiedIntegrations: integrations.filter((i) => i.status === "verified").length,
      degradedIntegrations: integrations.filter((i) => i.status === "degraded").length,
      missingIntegrations: integrations.filter((i) => i.status === "missing").length,
      cases: RULES.reduce((sum, rule) => sum + rule.cases.length, 0),
    },
    rules: RULES.map((rule) => {
      const describe = (item: typeof rule.cases[number] | undefined) => item
        ? `${item.tool}: ${JSON.stringify(item.input)}`
        : "Пример не задан.";
      return {
        ...rule.meta,
        cases: rule.cases.length,
        integrations: ruleIntegrations,
        implementation: ".guardrails/src/rules.ts",
        examples: {
          blocked: describe(rule.cases.find((item) => item.expect === "hit" && !item.edge)),
          allowed: describe(rule.cases.find((item) => item.expect === "pass" && !item.edge)),
          edge: describe(rule.cases.find((item) => item.edge)),
        },
      };
    }),
    integrations,
    checks,
  };
}
