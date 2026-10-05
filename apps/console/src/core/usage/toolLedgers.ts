import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { PROVIDER_PRESETS } from "../providers";
import {
  applyUsageCollection,
  modelToProvider,
  readProviderUsage,
  vendorModelIndex,
  type UsageRecord,
} from "../providerUsage";
import { readNewLines } from "./runtimeTranscripts";

/**
 * Коллектор собственных счётчиков инструментов (источник "tool-ledger"):
 *  - graphify: graphify-out/.graphify_cost.json - кумулятивные итоги билдов,
 *    пишется дельта от прошлого сбора;
 *  - headroom: ~/.headroom/savings_events.jsonl - события сжатия контекста
 *    (saved токенов на модель провайдера), инкремент по позиции файла.
 * rtk не учитывается: это сжатие shell-вывода, не LLM-токены (tools-usage.json).
 */

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Первое числовое поле из списка имён (форматы ledger'ов меняются между версиями). */
function firstNumber(source: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    if (num(source[name]) > 0) return num(source[name]);
  }
  return 0;
}

/**
 * Леджеры graphify: корневой graphify-out (интеграционный граф репозитория)
 * плюс графы воркспейсов хранилища <repoRoot>/graphify/<имя>/graphify-out.
 */
async function graphifyCostFiles(repoRoot: string): Promise<string[]> {
  const files = [path.join(repoRoot, "graphify-out", ".graphify_cost.json")];
  let entries;
  try {
    entries = await readdir(path.join(repoRoot, "graphify"), { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(path.join(repoRoot, "graphify", entry.name, "graphify-out", ".graphify_cost.json"));
  }
  return files;
}

async function graphifyTotals(file: string): Promise<{ input: number; output: number; model?: string } | null> {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const input = firstNumber(json, ["total_input_tokens", "totalInputTokens", "input_tokens"]);
  const output = firstNumber(json, ["total_output_tokens", "totalOutputTokens", "output_tokens"]);
  if (!input && !output) return null;
  const model = typeof json.model === "string" ? json.model : undefined;
  return { input, output, model };
}

async function collectGraphify(
  repoRoot: string,
  cumulative: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>,
  vendors: Map<string, string>,
  records: UsageRecord[],
): Promise<void> {
  for (const file of await graphifyCostFiles(repoRoot)) {
    const key = `graphify:${file}`;
    const totals = await graphifyTotals(file);
    if (!totals) continue;
    const previous = cumulative[key];
    const input = previous ? Math.max(0, totals.input - previous.inputTokens) : totals.input;
    const output = previous ? Math.max(0, totals.output - previous.outputTokens) : totals.output;
    if (input || output) {
      records.push({
        at: new Date().toISOString(),
        source: "tool-ledger",
        provider: totals.model ? modelToProvider(totals.model, vendors) ?? "graphify" : "graphify",
        model: totals.model,
        kind: "graphify-build",
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
      });
    }
    cumulative[key] = { inputTokens: totals.input, outputTokens: totals.output, totalTokens: totals.input + totals.output };
  }
}

async function collectHeadroom(
  home: string,
  cursors: Record<string, number>,
  vendors: Map<string, string>,
  records: UsageRecord[],
): Promise<void> {
  const file = path.join(home, ".headroom", "savings_events.jsonl");
  const size = await stat(file).then((info) => info.size).catch(() => null);
  if (size === null) return;
  const key = `headroom:${file}`;
  const { lines, cursor } = await readNewLines(file, size, cursors[key], 2_000_000);
  cursors[key] = cursor;
  const presetIds = new Set(PROVIDER_PRESETS.map((preset) => preset.id));
  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const saved = num(event.saved);
    if (!saved) continue;
    const model = typeof event.model === "string" ? event.model : undefined;
    const eventProvider = typeof event.provider === "string" ? event.provider : "";
    const provider = (model && modelToProvider(model, vendors)) || (eventProvider && presetIds.has(eventProvider) ? eventProvider : null);
    records.push({
      at: typeof event.ts === "string" ? new Date(event.ts).toISOString() : new Date().toISOString(),
      source: "tool-ledger",
      provider: provider ?? "headroom",
      model,
      kind: typeof event.client === "string" ? `headroom:${event.client}` : "headroom",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: saved,
      details: num(event.new_input) ? { newInputTokens: num(event.new_input) } : undefined,
    });
  }
}

export interface ToolLedgerOptions {
  home?: string;
}

/** Сбор счётчиков инструментов: graphify (дельта итогов) и headroom (события). */
export async function collectToolLedgers(repoRoot: string, opts: ToolLedgerOptions = {}): Promise<number> {
  const home = opts.home ?? homedir();
  const store = await readProviderUsage(repoRoot);
  const cursors = { ...store.cursors };
  const cumulative = { ...store.cumulative };
  const vendors = await vendorModelIndex(repoRoot);
  const records: UsageRecord[] = [];

  await collectGraphify(repoRoot, cumulative, vendors, records);
  await collectHeadroom(home, cursors, vendors, records);

  await applyUsageCollection(repoRoot, { records, cursors, cumulative });
  return records.length;
}
