import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAudit, stableJson } from "./audit";
import { INTEGRATIONS } from "./integrations";
import { RULES } from "./rules";

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function generatedFiles(root: string): Record<string, string> {
  const audit = buildAudit(root);
  audit.generatedAt = "source-controlled";
  const catalog = ["# Каталог Guardrails", "", "Этот файл генерируется из `.guardrails/src/rules.ts`.", "", "| ID | Эффект | Критичность | Категория | Тесты |", "|---|---|---|---|---:|", ...audit.rules.map((r) => `| \`${r.id}\` | ${r.effect} | ${r.severity} | ${r.category} | ${r.cases} |`), ""].join("\n");
  const integrations = ["# Интеграции Guardrails", "", "| Контекст | Тип | Источник | Failure mode |", "|---|---|---|---|", ...INTEGRATIONS.map((i) => `| \`${i.id}\` | ${i.kind} | \`${i.source}\` | ${i.expectedFailureMode} |`), ""].join("\n");
  const coverage = ["# Покрытие Guardrails", "", `Правил: **${audit.totals.rules}**. Кейсов: **${audit.totals.cases}**.`, "", "Каждое правило обязано иметь положительный, отрицательный и граничный тест.", ""].join("\n");
  const threats = ["# Покрытие угроз", "", "| Угроза | Правила |", "|---|---|", ...Object.entries(Object.groupBy(audit.rules.flatMap((r) => r.threats.map((t) => ({ t, id: r.id }))), (x) => x.t)).sort(([a], [b]) => a.localeCompare(b)).map(([t, rows]) => `| ${t} | ${rows!.map((x) => `\`${x.id}\``).join(", ")} |`), ""].join("\n");
  return {
    ".guardrails/generated/CATALOG.md": catalog,
    ".guardrails/generated/INTEGRATIONS.md": integrations,
    ".guardrails/generated/COVERAGE.md": coverage,
    ".guardrails/generated/THREAT-COVERAGE.md": threats,
    ".guardrails/generated/inventory.json": json(audit),
    ".guardrails/generated/coverage.json": json({ rules: audit.rules.map((r) => ({ id: r.id, cases: r.cases })) }),
    ".guardrails/generated/policy-digest.json": json({ policyVersion: audit.policyVersion, sha256: audit.policyDigest }),
    ".guardrails/integrations/registry.json": json(INTEGRATIONS),
  };
}

export function generate(root: string): void {
  const rulesDir = join(root, ".guardrails", "rules");
  rmSync(rulesDir, { recursive: true, force: true });
  mkdirSync(rulesDir, { recursive: true });
  for (const guard of RULES) {
    const dir = join(rulesDir, guard.meta.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "rule.json"), json(guard.meta));
    writeFileSync(join(dir, "cases.json"), json(guard.cases));
    writeFileSync(join(dir, "README.md"), `# ${guard.meta.id}\n\n${guard.meta.description}\n\n**Действие:** ${guard.meta.effect}. **Критичность:** ${guard.meta.severity}.\n\n**Исправление:** ${guard.meta.remediation}\n`);
  }
  for (const [relative, content] of Object.entries(generatedFiles(root))) {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
}

export function generatedDocsCurrent(root: string): boolean {
  try { return Object.entries(generatedFiles(root)).every(([relative, expected]) => readFileSync(join(root, relative), "utf8") === expected); } catch { return false; }
}
