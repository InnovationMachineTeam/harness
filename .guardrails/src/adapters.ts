#!/usr/bin/env bun
// Проверка и рендер рантайм-адаптеров Guardrails. Отдельная входная точка:
// cli.ts защищён правилом structural.guard-mutation.
//   bun .guardrails/src/adapters.ts check          - сверка файлов и маркеров
//   bun .guardrails/src/adapters.ts render <id>    - фрагменты конфигурации для рантайма
// Добавление рантайма: запись в RUNTIME_ADAPTERS (runtimeAdapters.ts),
// затем фрагменты из render переносятся в конфигурацию рантайма.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RUNTIME_ADAPTERS, adapterById } from "./runtimeAdapters";

export interface AdapterCheckRow {
  id: string;
  ok: boolean;
  detail: string;
}

export function adaptersCheck(repoRoot: string): AdapterCheckRow[] {
  const rows = RUNTIME_ADAPTERS.flatMap((adapter) =>
    adapter.hooks.map((hook) => {
      const id = `runtime:${adapter.id}:${hook.event}`;
      const target = join(repoRoot, hook.file);
      if (!existsSync(target)) return { id, ok: false, detail: `Файл отсутствует: ${hook.file}` };
      const content = readFileSync(target, "utf8");
      return content.includes(hook.marker)
        ? { id, ok: true, detail: "Маркер найден." }
        : { id, ok: false, detail: `Маркер не найден: ${hook.marker}` };
    }),
  );
  // Зеркало Kimi - пользовательский файл вне репозитория; он единственный
  // действующий путь хука для Kimi, поэтому дрейф проверяется отдельно.
  const mirror = join(homedir(), ".kimi-code", "config.toml");
  if (!existsSync(mirror)) {
    rows.push({ id: "mirror:kimi:PreToolUse", ok: true, detail: "Зеркало не установлено - проверка пропущена." });
    return rows;
  }
  const mirrorContent = readFileSync(mirror, "utf8");
  if (mirrorContent.includes("runtime/guard.mjs")) {
    rows.push({ id: "mirror:kimi:PreToolUse", ok: false, detail: "Зеркало указывает на устаревший guard.mjs - скопируйте блоки из .kimi/config.toml." });
  } else if (mirrorContent.includes(".guardrails/src/cli.ts")) {
    rows.push({ id: "mirror:kimi:PreToolUse", ok: true, detail: "Зеркало содержит актуальный маркер." });
  } else {
    rows.push({ id: "mirror:kimi:PreToolUse", ok: false, detail: "В зеркале нет маркера Guardrails." });
  }
  return rows;
}

function render(runtimeId: string): never {
  const adapter = adapterById(runtimeId);
  if (!adapter) {
    console.error(`adapters: неизвестный рантайм ${runtimeId}. Доступны: ${RUNTIME_ADAPTERS.map((item) => item.id).join(", ")}`);
    process.exit(1);
  }
  console.log(`# ${adapter.title}: фрагменты конфигурации Guardrails`);
  console.log(`# LLM-путь: ${adapter.llmGuard === "wrapped" ? "guard уже в фабрике моделей" : "модели оборачиваются withLlmGuard / chatModelForProvider; LangGraph - узел langGraphGuardNode"}`);
  for (const hook of adapter.hooks) {
    console.log(`\n# ${hook.event} (${hook.failMode === "closed" ? "fail-closed" : "fail-open"})${hook.matcher ? `, matcher: ${hook.matcher}` : ""}`);
    console.log(JSON.stringify({ event: hook.event, ...(hook.matcher ? { matcher: hook.matcher } : {}), command: hook.command, notes: hook.notes }, null, 2));
  }
  console.log(`\n# ${adapter.extensionNotes}`);
  process.exit(0);
}

function main(): never {
  const [command = "check", arg] = process.argv.slice(2);
  if (command === "render" && arg) return render(arg);
  const rows = adaptersCheck(process.cwd());
  for (const row of rows) console.log(`${row.ok ? "ok " : "FAIL"}\t${row.id}\t${row.detail}`);
  const failed = rows.filter((row) => !row.ok).length;
  console.error(`adapters: ${rows.length - failed}/${rows.length} точек подтверждены`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) main();
