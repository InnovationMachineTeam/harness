#!/usr/bin/env bun
// Разовая проверка истории Git на секреты и персональные данные.
// Отдельная входная точка: cli.ts защищён правилом structural.guard-mutation.
// Использование: bun guardrails/src/scanhistory.ts [--all | --range <expr>] [--limit N] [--show-values] [--fail-on-secrets]
// Поверхность скана - "write"; пути самодиагностики Guardrails и .agents/.tmp исключены.
// Значения персональных данных печатаются только с --show-values; классы secret.*
// идут без содержимого. Exit: 0 без секретов, 2 при --fail-on-secrets и найденных
// secret.*, 1 - ошибка выполнения.

import { createHash, randomUUID } from "node:crypto";
import policy from "../policy.json";
import { policyDigest } from "./audit";
import { appendDecision } from "./audit-log";
import { CONTENT_PATTERNS } from "./content/patterns";
import { highEntropyTokens, scanText } from "./content/scan";
import { SELF_ARTIFACTS } from "./content/selfscan";

interface HistoryFinding {
  sha: string;
  file: string;
  line: number;
  patternId: string;
  title: string;
  text: string;
}

function recordAudit(repo: string, summary: string, effect: string): void {
  appendDecision(repo, {
    schemaVersion: 1,
    decisionId: randomUUID(),
    at: new Date().toISOString(),
    policyDigest: policyDigest(),
    runtime: process.env.AGENT_RUNTIME ?? "unknown",
    integrationId: "manual:scan-history",
    inputDigest: createHash("sha256").update(summary).digest("hex"),
    malformed: false,
    effect,
    ruleId: null,
    reason: summary,
    latencyMs: 0,
    exceptionId: null,
  });
}

const skippedPath = (file: string): string | null => {
  if (SELF_ARTIFACTS.test(file)) return "guardrails-artifacts";
  if (file.startsWith(".agents/.tmp/") || file.startsWith(".agents/.worktrees/")) return "agents-tmp";
  return null;
};

/** Первое совпадение паттерна в строке; используется только для --show-values по классам pii.*. */
export function firstMatch(patternId: string, text: string): string | undefined {
  const pattern = CONTENT_PATTERNS.find((item) => item.id === patternId);
  if (!pattern) return undefined;
  return new RegExp(pattern.regex.source, pattern.regex.flags).exec(text)?.[0];
}

/** Добавленные строки diff с номерами: общий источник для скана и entropy-подсчёта. */
export function addedLines(output: string): Array<{ file: string; line: number; text: string }> {
  const rows: Array<{ file: string; line: number; text: string }> = [];
  let file = "";
  let line = 0;
  for (const raw of output.split("\n")) {
    if (raw.startsWith("+++ b/")) {
      file = raw.slice(6).trim();
      continue;
    }
    if (raw.startsWith("@@")) {
      const hunk = raw.match(/\+\d+/);
      line = hunk ? Number(hunk[0].slice(1)) : 0;
      continue;
    }
    if (!raw.startsWith("+") || raw.startsWith("+++") || !file) continue;
    rows.push({ file, line, text: raw.slice(1) });
    line++;
  }
  return rows;
}

/** Парсит вывод git show --unified=0; возвращает находки добавленных строк. */
export function parseShowOutput(sha: string, output: string): HistoryFinding[] {
  const findings: HistoryFinding[] = [];
  for (const row of addedLines(output)) {
    if (skippedPath(row.file)) continue;
    for (const finding of scanText(row.text, "write")) {
      findings.push({ sha, file: row.file, line: row.line, patternId: finding.patternId, title: finding.title, text: row.text });
    }
  }
  return findings;
}

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    console.error(`scan-history: git ${args.join(" ")} завершился с кодом ${proc.exitCode}`);
    process.exit(1);
  }
  return new TextDecoder().decode(proc.stdout);
}

function main(): never {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const range = flag("all") || !value("--range") ? ["--all"] : [value("--range")!];
  const limit = Number(value("--limit") ?? 0);
  const showValues = flag("--show-values");
  const failOnSecrets = flag("--fail-on-secrets");

  const shas = git(["rev-list", ...range], cwd).split("\n").filter(Boolean);
  const commits = limit > 0 ? shas.slice(0, limit) : shas;
  const findings: HistoryFinding[] = [];
  let entropyCount = 0;
  for (let index = 0; index < commits.length; index++) {
    if (index % 200 === 0 && index > 0) console.error(`scan-history: проверено ${index} из ${commits.length} коммитов`);
    const output = git(["show", commits[index]!, "--unified=0", "--no-color", "--no-renames", "--format="], cwd);
    findings.push(...parseShowOutput(commits[index]!, output));
    entropyCount += addedLines(output).filter((row) => !skippedPath(row.file)).reduce((sum, row) => sum + highEntropyTokens(row.text).length, 0);
  }

  for (const finding of findings) {
    const parts = [finding.sha.slice(0, 10), `${finding.file}:${finding.line}`, finding.patternId, finding.title];
    if (showValues && finding.patternId.startsWith("pii.")) {
      const matched = firstMatch(finding.patternId, finding.text);
      if (matched) parts.push(matched);
    }
    console.log(parts.join("\t"));
  }
  const secrets = findings.filter((finding) => finding.patternId.startsWith("secret."));
  const pii = findings.filter((finding) => finding.patternId.startsWith("pii."));
  console.error(`scan-history: коммитов ${commits.length}, находок ${findings.length} (секреты: ${secrets.length}, ПДн: ${pii.length}, entropy-токены: ${entropyCount})`);
  recordAudit(cwd, `commits=${commits.length} secrets=${secrets.length} pii=${pii.length}`, secrets.length ? "block" : pii.length ? "warn" : "allow");

  if (secrets.length && failOnSecrets) process.exit(2);
  process.exit(0);
}

if (import.meta.main) main();
