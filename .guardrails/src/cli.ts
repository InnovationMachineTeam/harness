#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import policy from "../policy.json";
import { buildAudit } from "./audit";
import { generate, generatedDocsCurrent } from "./generate";
import { evaluate } from "./rules";
import { RULES } from "./rules";
import { scanText } from "./content/scan";
import { ProbeStore } from "./content/probes";
import { randomUUID } from "node:crypto";
import { policyDigest } from "./audit";
import { findException } from "./exceptions/loader";
import { writeHookStatus } from "./mimosa";

function root(): string {
  let current = process.cwd();
  while (current !== dirname(current)) {
    try { if (readFileSync(join(current, ".guardrails", "policy.json"), "utf8")) return current; } catch {}
    current = dirname(current);
  }
  return process.cwd();
}

function settings(repo: string): void {
  const runtime = process.env.AGENT_RUNTIME ?? "claude";
  const rootConfig = JSON.parse(readFileSync(join(repo, ".agents/runtime/config.json"), "utf8")) as Record<string, any>;
  const configPath = resolve(repo, process.env.AGENT_RUNTIME_CONFIG ?? `.agents/runtime/${runtime}/config.json`);
  const vendor = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, any>;
  const profileName = process.env.AGENT_PROFILE ?? "default";
  const profile = rootConfig.profiles?.[profileName] ?? {};
  const limits = { ...(rootConfig.limits ?? {}), ...(profile.limits ?? {}) };
  console.log("========================================================================");
  console.log("AGENT RUNTIME SETTINGS");
  console.log(`runtime:            ${runtime}`);
  console.log(`adapter:            ${vendor.vendorAdapter ?? "-"}`);
  console.log(`hooksSupport:       ${vendor.guard?.hooksSupport ?? "-"}`);
  console.log(`guard:              ${rootConfig.guard ?? "-"}`);
  console.log(`profile:            ${profileName} (defaultModel: ${profile.defaultModel ?? "-"})`);
  console.log("models:");
  for (const [tier, model] of Object.entries(vendor.models ?? {}) as Array<[string, any]>) console.log(`  ${tier.padEnd(11)} ${String(model.model).padEnd(34)} ${model.thinkingLevel ?? ""} [${model.verified ? "verified" : "NOT verified"}]`);
  console.log("limits:");
  for (const [key, value] of Object.entries(limits)) console.log(`  ${key.padEnd(22)} ${value}`);
  console.log("verification:");
  for (const [key, value] of Object.entries(rootConfig.verification ?? {})) console.log(`  ${key.padEnd(12)} ${value}`);
  console.log("========================================================================");
}

function recordAudit(repo: string, payload: unknown, result: ReturnType<typeof evaluate>, malformed = false, exceptionId: string | null = null, reason = "", latencyMs = 0): void {
  const target = resolve(repo, policy.audit.events);
  const event = {
    schemaVersion: 1,
    decisionId: randomUUID(),
    at: new Date().toISOString(),
    policyDigest: policyDigest(),
    runtime: process.env.AGENT_RUNTIME ?? "unknown",
    integrationId: process.env.GUARDRAILS_INTEGRATION ?? "manual",
    inputDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    malformed,
    effect: malformed ? "block" : result?.effect ?? "allow",
    ruleId: result?.ruleId ?? null,
    reason: malformed ? "payload.invalid-json" : (result?.reason ?? reason),
    latencyMs,
    exceptionId,
  };
  try {
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {}
}

async function evaluateStdin(repo: string): Promise<never> {
  const startedAt = Date.now();
  const input = await Bun.stdin.text();
  let payload: { tool_name?: unknown; tool_input?: unknown };
  try { payload = JSON.parse(input); } catch {
    recordAudit(repo, { invalid: true }, null, true, null, "payload.invalid-json", 0);
    console.error("guardrails: BLOCKED by payload.invalid-json - stdin должен содержать JSON {tool_name, tool_input}");
    console.error("Instead: исправьте адаптер; повреждённый payload не обходит политику.");
    process.exit(2);
  }
  const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input as Record<string, unknown> : {};
  const path = typeof toolInput.file_path === "string" ? toolInput.file_path : typeof toolInput.path === "string" ? toolInput.path : undefined;
  let result = evaluate(payload.tool_name, payload.tool_input, process.env.AGENT_RUNTIME);
  let exceptionId: string | null = null;
  if (result) {
    const exception = findException(repo, {
      ruleId: result.ruleId,
      tool: typeof payload.tool_name === "string" ? payload.tool_name : undefined,
      path,
      command: typeof toolInput.command === "string" ? toolInput.command : undefined,
    });
    if (exception) {
      exceptionId = exception.id;
      console.error(`guardrails: исключение ${exception.id} применено к правилу ${result.ruleId} (${exception.reason}); решение - разрешить.`);
      result = null;
    }
  }
  recordAudit(repo, payload, result, false, exceptionId, result?.reason ?? "", Date.now() - startedAt);
  writeHookStatus(repo, {
    sessionId: typeof payload.session_id === "string" ? payload.session_id : typeof payload.sessionId === "string" ? payload.sessionId : "unknown",
    event: "PreToolUse",
    toolName: typeof payload.tool_name === "string" ? payload.tool_name : undefined,
    file: path,
    outcome: exceptionId || !result ? "clear" : result.effect === "block" ? "blocked" : "warn",
    findingCount: result ? 1 : 0,
    durationMs: Date.now() - startedAt,
  });
  if (!result) process.exit(0);
  console.error(`guardrails: ${result.effect === "block" ? "BLOCKED" : "WARN"} by ${result.ruleId} - ${result.reason}`);
  console.error(`Instead: ${result.remediation}`);
  process.exit(result.effect === "block" ? 2 : 0);
}

async function promptStdin(repo: string): Promise<never> {
  const input = await Bun.stdin.text();
  let payload: { prompt?: unknown; session_id?: unknown; surface?: unknown };
  try { payload = JSON.parse(input); } catch {
    recordAudit(repo, { invalid: true }, null, true, null, "payload.invalid-json", 0);
    console.error("guardrails: BLOCKED by payload.invalid-json - stdin должен содержать JSON {prompt, session_id, surface}");
    console.error("Instead: исправьте адаптер; повреждённый payload не обходит политику.");
    process.exit(2);
  }
  const startedAt = Date.now();
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : "anonymous";
  const agentSurface = payload.surface === "agent";
  const report = (outcome: "clear" | "warn" | "blocked", findingCount: number) => {
    if (typeof payload.session_id !== "string") return;
    writeHookStatus(repo, { sessionId: payload.session_id, event: "UserPromptSubmit", outcome, findingCount, durationMs: Date.now() - startedAt });
  };
  const probe = new ProbeStore(repo).record(sessionId, prompt);
  const findings = scanText(prompt, "prompt");
  const injection = findings.find((finding) => finding.patternId.startsWith("inj."));
  if (probe.blocked) {
    const result = { effect: "block" as const, ruleId: "prompt.pii-probe", reason: `Многоходовой сбор персональных данных: ${probe.count} зондов в сессии.`, remediation: "Запросите данные у источника напрямую; не уточняйте их через модель." };
    recordAudit(repo, payload, result);
    report("blocked", 1);
    console.error(`guardrails: BLOCKED by ${result.ruleId} - ${result.reason}`);
    console.error(`Instead: ${result.remediation}`);
    process.exit(2);
  }
  if (injection && agentSurface) {
    const result = { effect: "block" as const, ruleId: "prompt.injection", reason: `Промпт содержит "${injection.title}".`, remediation: "Данные передавайте как данные, не как инструкции; инъекция найдена в промпте автоматизированного вызова." };
    recordAudit(repo, payload, result);
    report("blocked", 1);
    console.error(`guardrails: BLOCKED by ${result.ruleId} - ${result.reason}`);
    console.error(`Instead: ${result.remediation}`);
    process.exit(2);
  }
  if (injection || findings.some((finding) => finding.patternId.startsWith("marker."))) {
    const ruleId = injection ? "prompt.injection" : "prompt.confidential-marker";
    const labels = [...(injection ? [injection.title] : []), ...findings.filter((finding) => finding.patternId.startsWith("marker.")).map((finding) => finding.title)];
    recordAudit(repo, payload, { effect: "warn", ruleId, reason: labels.join(", "), remediation: "Проверьте промпт перед отправкой в модель." });
    console.error(`guardrails: WARN by ${ruleId} - ${labels.join(", ")}`);
    report("warn", findings.length);
  } else {
    report("clear", 0);
  }
  process.exit(0);
}

async function scanDiffStdin(repo: string): Promise<never> {
  const diff = await Bun.stdin.text();
  if (!diff.trim()) process.exit(0);
  const lines = diff.split("\n");
  const findings: Array<{ patternId: string; title: string; line: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const finding of scanText(line.slice(1), "write")) {
      findings.push({ patternId: finding.patternId, title: finding.title, line: index + 1 });
    }
  }
  const secrets = findings.filter((finding) => finding.patternId.startsWith("secret."));
  if (secrets.length) {
    const detail = secrets.map((finding) => `${finding.title} (строка diff ${finding.line})`).join(", ");
    recordAudit(repo, { lines: lines.length }, { effect: "block", ruleId: "content.scan-diff", reason: `Diff содержит секреты: ${detail}.`, remediation: "Вынесите значение в переменную окружения или менеджер секретов и удалите строку из индекса." });
    console.error(`guardrails: BLOCKED by content.scan-diff - в diff секреты: ${detail}`);
    console.error("Instead: вынесите значение в переменную окружения или менеджер секретов.");
    process.exit(2);
  }
  const pii = findings.filter((finding) => finding.patternId.startsWith("pii."));
  if (pii.length) {
    const detail = pii.map((finding) => `${finding.title} (строка diff ${finding.line})`).join(", ");
    recordAudit(repo, { lines: lines.length }, { effect: "warn", ruleId: "content.write-pii", reason: `Diff содержит персональные данные: ${detail}.`, remediation: "Замените персональные данные обезличенными примерами." });
    console.error(`guardrails: WARN by content.write-pii - в diff персональные данные: ${detail}`);
  }
  process.exit(0);
}

async function main() {
  const repo = root();
  const [command = "evaluate", ...args] = process.argv.slice(2);
  if (command === "evaluate") return evaluateStdin(repo);
  if (command === "prompt") return promptStdin(repo);
  if (command === "scan-diff") return scanDiffStdin(repo);
  if (command === "settings") { settings(repo); return; }
  if (command === "generate") { generate(repo); console.log("Guardrails: документы и реестр обновлены."); return; }
  if (command === "audit") { console.log(JSON.stringify(buildAudit(repo), null, args.includes("--json") ? 2 : 2)); return; }
  if (command === "list") { for (const item of RULES) console.log(`${item.meta.id}\t${item.meta.effect}\t${item.meta.severity}\t${item.meta.title}`); return; }
  if (command === "explain") {
    const item = RULES.find((rule) => rule.meta.id === args[0]);
    if (!item) { console.error(`Guardrails: неизвестное правило ${args[0] ?? ""}.`); process.exit(1); }
    console.log(JSON.stringify({ ...item.meta, cases: item.cases }, null, 2)); return;
  }
  if (command === "where") {
    const audit = buildAudit(repo); const id = args[0];
    console.log(JSON.stringify(id ? audit.integrations.filter((item) => item.bundles.some((b) => RULES.find((r) => r.meta.id === id)?.meta.bundles.includes(b))) : audit.integrations, null, 2)); return;
  }
  if (command === "docs") {
    if (args.includes("--write")) { generate(repo); return; }
    if (!generatedDocsCurrent(repo)) { console.error("Guardrails: сгенерированные документы устарели. Выполните bun guardrails/src/cli.ts generate."); process.exit(1); }
    console.log("Guardrails: сгенерированные документы актуальны."); return;
  }
  if (command === "check") {
    const audit = buildAudit(repo);
    const failed = audit.checks.filter((check) => !check.ok);
    if (!args.includes("--quick") && !generatedDocsCurrent(repo)) failed.push({ id: "docs.current", ok: false, detail: "Сгенерированные документы устарели." });
    if (failed.length) { for (const check of failed) console.error(`${check.id}: ${check.detail}`); process.exit(1); }
    console.log(`Guardrails: ${audit.totals.rules} правил, ${audit.totals.cases} кейсов, ${audit.totals.verifiedIntegrations}/${audit.totals.integrations} интеграций подтверждены.`); return;
  }
  console.error(`Guardrails: неизвестная команда ${command}.`); process.exit(1);
}

await main();
