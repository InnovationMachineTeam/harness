import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// Практика sber500 (source-scan): обход guard на уровне консоли невозможен
// по построению. LangChain-модели создаются только в единой фабрике
// langchain/chatModel.ts, где каждая обёрнута withLlmGuard; прямой импорт
// провайдерных пакетов вне фабрики запрещён.

const SRC = resolve(import.meta.dir, "..", "..");
const FACTORY = join(SRC, "core", "langchain", "chatModel.ts");

const PROVIDER_CONSTRUCTOR = /new\s+Chat(OpenAI|Anthropic|GoogleGenerativeAI)\s*\(/;
const PROVIDER_IMPORT = /from\s+"@langchain\/(openai|anthropic|google-genai)"/;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const target = join(dir, name);
    if (statSync(target).isDirectory()) {
      files.push(...walk(target));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) files.push(target);
  }
  return files;
}

describe("source-scan: единственная точка сборки моделей", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (file.includes("__tests__") || file === FACTORY) continue;
    const content = readFileSync(file, "utf8");
    if (PROVIDER_CONSTRUCTOR.test(content) || PROVIDER_IMPORT.test(content)) offenders.push(file);
  }

  test("LangChain-модели создаются только в chatModel.ts", () => expect(offenders.join("\n")).toBe(""));
});
