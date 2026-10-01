import { spawn } from "node:child_process";

/**
 * Поиск навыков через CLI `bunx skills find <query>` (реестр skills.sh).
 * CLI интерактивный: в piped-режиме печатает список результатов и ждёт
 * выбора - список попадает в stdout до ожидания, поэтому читаем вывод
 * с таймаутом и завершаем процесс. Вывод чистим от ANSI и парсим.
 */

export interface FoundSkill {
  id: string;
  name: string;
  source: string;
  installs?: number;
  /** Страница навыка на skills.sh (из строки `└ https://skills.sh/…`). */
  url?: string;
}

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
const FIND_TIMEOUT_MS = 15_000;

/** Безопасный запрос для CLI-аргумента: буквы/цифры/пробел/-/._ , до 60 символов. */
export function isValidFindQuery(query: string): boolean {
  return /^[\w\s\-./@]{2,60}$/.test(query.trim());
}

/** Последний сырой вывод CLI (для отладки парсера через ?debug=1). */
export let lastRawOutput = "";

/** Запустить `bunx skills find <query>`, собрать текст (ANSI-чистый). */
export async function runSkillsFind(query: string): Promise<{ ok: boolean; text: string }> {
  const q = query.trim();
  if (!isValidFindQuery(q)) return { ok: false, text: "" };

  return new Promise((resolve) => {
    const child = spawn("bunx", ["skills", "find", q], {
      cwd: process.env.HARNESS_REPO_ROOT ?? process.cwd(),
      env: { ...process.env, DISABLE_TELEMETRY: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let text = "";
    const onChunk = (chunk: Buffer) => {
      text += chunk.toString("utf8").replace(ANSI_RE, "");
      if (text.length > 64_000) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* уже завершён */
        }
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    const finish = (ok: boolean) => {
      child.removeAllListeners();
      try {
        child.kill("SIGKILL");
      } catch {
        /* уже завершён */
      }
      lastRawOutput = text.slice(0, 16_000);
      resolve({ ok, text: lastRawOutput });
    };

    const timer = setTimeout(() => finish(true), FIND_TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer);
      finish(true);
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/**
 * Разбор списка результатов из вывода CLI. Формат (по факту, без ANSI):
 *   open.feishu.cn@lark-doc 737.7K installs
 *   └ https://skills.sh/open.feishu.cn/lark-doc
 * Идентификатор для установки - `owner/repo@skill` (как в подсказке CLI
 * "Install with npx skills add <owner/repo@skill>").
 */
export function parseFindResults(text: string): FoundSkill[] {
  const items: FoundSkill[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && items.length < 8; i++) {
    const line = lines[i].replace(/└/g, " ").trim();
    const m = line.match(/^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)@([A-Za-z0-9_.-]+)\s+([\d.,]+[kKmM]?)\s+installs?$/);
    if (!m) continue;
    const [, source, name, instRaw] = m;
    const norm = instRaw.toLowerCase();
    const mult = norm.endsWith("k") ? 1_000 : norm.endsWith("m") ? 1_000_000 : 1;
    const installs = Math.round(parseFloat(norm.replace(/[km,]/g, "")) * mult);
    const id = `${source}@${name}`;
    if (seen.has(id)) continue;
    // следующая строка пункта: └ https://skills.sh/<source>/<skill>
    const urlMatch = (lines[i + 1] ?? "").match(/https:\/\/skills\.sh\/[A-Za-z0-9_./@-]+/);
    seen.add(id);
    items.push({ id, name, source, installs, url: urlMatch?.[0] });
  }
  return items;
}

/** Кеш поиска (TTL 60 c) - автодополнение не должно спавнить CLI на каждый ввод. */
const cache = new Map<string, { at: number; items: FoundSkill[] }>();
const TTL_MS = 60_000;

export async function findSkillsCached(query: string): Promise<{ items: FoundSkill[]; fromCache: boolean }> {
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { items: cached.items, fromCache: true };
  }
  const { text } = await runSkillsFind(query);
  const items = parseFindResults(text);
  cache.set(key, { at: Date.now(), items });
  return { items, fromCache: false };
}
