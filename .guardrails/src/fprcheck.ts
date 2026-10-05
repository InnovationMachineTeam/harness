#!/usr/bin/env bun
// Замер ложных срабатываний: корпус чистых промптов против guardPrompt.
// Детерминированно, без вызова модели. Использование:
//   bun .guardrails/src/fprcheck.ts            - сводка и подробности срабатываний
//   bun .guardrails/src/fprcheck.ts --quiet    - только итоговая строка
// Регрессия закреплена тестом tests/fpr.test.ts: корпус обязан проходить на 100%.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLlmGuard } from "./llm/guard";
import { SessionRegistry } from "./llm/session";

interface CleanCorpus {
  version: number;
  prompts: string[];
}

export interface CleanVerdict {
  index: number;
  blocked: boolean;
  ruleId?: string;
  applied: string[];
  warnings: string[];
}

export function checkCleanPrompts(prompts: string[], guard = createLlmGuard({ registry: new SessionRegistry() })): CleanVerdict[] {
  return prompts.map((prompt, index) => {
    const result = guard.guardPrompt(prompt);
    return { index, blocked: result.blocked, ruleId: result.ruleId, applied: result.applied, warnings: result.warnings };
  });
}

export function loadCleanCorpus(path = resolve(import.meta.dir, "..", "tests", "fixtures", "clean-prompts.json")): CleanCorpus {
  return JSON.parse(readFileSync(path, "utf8")) as CleanCorpus;
}

function main(): never {
  const quiet = process.argv.includes("--quiet");
  const corpus = loadCleanCorpus();
  const verdicts = checkCleanPrompts(corpus.prompts);
  const failed = verdicts.filter((verdict) => verdict.blocked || verdict.applied.length || verdict.warnings.length);
  if (!quiet) {
    for (const verdict of failed) {
      const prompt = corpus.prompts[verdict.index]!;
      console.log(`#${verdict.index + 1}\t${verdict.blocked ? `BLOCK ${verdict.ruleId}` : verdict.applied.length ? `REDACT ${verdict.applied.join(",")}` : `WARN ${verdict.warnings.join(",")}`}\t${prompt}`);
    }
  }
  const fpr = corpus.prompts.length ? failed.length / corpus.prompts.length : 0;
  console.log(`fpr-check: промптов ${corpus.prompts.length}, ложных срабатываний ${failed.length}, доля ${(fpr * 100).toFixed(1)}%`);
  process.exit(0);
}

if (import.meta.main) main();
