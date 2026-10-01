import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ConsoleState } from "../state";
import type { McpServerDef, McpTransport, TargetSyncResult } from "../types";
import { removeMcpSection, upsertMcpSection } from "@/lib/toml";

/**
 * Синк глобального реестра MCP в локальные файлы рантаймов.
 * Правило: каждый таргет управляет ТОЛЬКО именами из реестра консоли -
 * чужие записи в файлах не затрагиваются. Отключённый сервер удаляется из файлов,
 * но остаётся в реестре (toggle обратно вернёт его).
 *
 * Проектный .mcp.json получает серверы с глобальным enabled; пользовательские
 * конфиги рантаймов - серверы с учётом override рантайма (override ?? enabled).
 */

/** Имя MCP-сервера допускает только безопасный набор символов (без shell/путей). */
export function isValidMcpName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
}

function assertValidNames(names: string[]): void {
  for (const name of names) {
    if (!isValidMcpName(name)) {
      throw new Error(`Недопустимое имя MCP-сервера: ${JSON.stringify(name)}`);
    }
  }
}

type JsonEntry = Record<string, unknown>;

function stdioOrHttp(t: McpTransport, kind: "mcpServers" | "opencode"): JsonEntry {
  if (t.type === "http") {
    return kind === "opencode" ? { type: "remote", url: t.url } : { type: "http", url: t.url, ...(t.headers ?? {}) };
  }
  const base: JsonEntry =
    kind === "opencode" ? { type: "local", command: t.command } : { type: "stdio", command: t.command };
  if (t.args?.length) base.args = t.args;
  if (t.env && Object.keys(t.env).length > 0) base.env = t.env;
  return base;
}

function desiredFor(state: ConsoleState, runtimeId: string | null): Map<string, McpServerDef> {
  const out = new Map<string, McpServerDef>();
  for (const def of Object.values(state.mcp.servers)) {
    const enabled = runtimeId === null ? def.enabled : (def.runtimeOverrides?.[runtimeId] ?? def.enabled);
    if (enabled) out.set(def.name, def);
  }
  return out;
}

function registryNames(state: ConsoleState): string[] {
  return Object.keys(state.mcp.servers);
}

async function readJsonish(file: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(file, "utf8");
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      // JSONC: убираем блочные/строчные комментарии и пробуем снова
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1");
      return JSON.parse(stripped) as Record<string, unknown>;
    }
  } catch {
    return {};
  }
}

/** Мерж JSON-файла вида {<key>: {name: entry}} только по именам реестра. */
async function mergeJsonMap(
  file: string,
  key: string,
  names: string[],
  desired: Map<string, McpServerDef>,
  toEntry: (t: McpTransport) => JsonEntry,
): Promise<void> {
  assertValidNames(names);
  const root = await readJsonish(file);
  const map = { ...((root[key] as Record<string, unknown> | undefined) ?? {}) };
  for (const name of names) {
    const def = desired.get(name);
    if (def) map[name] = toEntry(def.transport);
    else delete map[name];
  }
  root[key] = map;
  await writeFile(file, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

/** Вызов CLI `claude mcp …`: бинарник фиксирован, аргументы - списком, без shell. */
function claudeMcpCli(args: string[]): { ok: boolean; error?: string } {
  if (args.some((a) => a.includes("\n") || a.includes("\0"))) {
    return { ok: false, error: "недопустимые символы в аргументах" };
  }
  const res = spawnSync("claude", ["mcp", ...args], { encoding: "utf8", timeout: 20_000 });
  if (res.error) return { ok: false, error: String(res.error) };
  if (res.status !== 0) {
    const stderr = (res.stderr ?? "").trim().slice(0, 300);
    // отсутствие сервера при remove - не ошибка
    if (/not found|no such|not configured|unknown/i.test(stderr)) return { ok: true };
    return { ok: false, error: stderr || `exit ${res.status}` };
  }
  return { ok: true };
}

interface Target {
  id: string;
  label: string;
  runtimes: string[];
  /** null = проектный таргет (глобальный toggle без override). */
  runtimeId: string | null;
  /**
   * managedNames - имена, которыми таргет владеет (реестр ∻ прошлые applied):
   * желаемые пишутся/обновляются, остальные из списка удаляются.
   */
  apply(repoRoot: string, state: ConsoleState, managedNames: string[]): Promise<void>;
}

const targets: Target[] = [
  {
    id: "project",
    label: "проектный .mcp.json",
    runtimes: ["claude", "codex", "zcode", "cursor", "kimi", "opencode"],
    runtimeId: null,
    async apply(repoRoot, state, managedNames) {
      await mergeJsonMap(
        path.join(repoRoot, ".mcp.json"),
        "mcpServers",
        managedNames,
        desiredFor(state, null),
        (t) => stdioOrHttp(t, "mcpServers"),
      );
    },
  },
  {
    id: "claude-user",
    label: "Claude Code (user)",
    runtimes: ["claude"],
    runtimeId: "claude",
    async apply(_repoRoot, state, managedNames) {
      assertValidNames(managedNames);
      const desired = desiredFor(state, "claude");
      const useCli = !spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10_000 }).error;
      if (useCli) {
        for (const name of managedNames) {
          claudeMcpCli(["remove", name, "-s", "user"]);
          const def = desired.get(name);
          if (def) {
            const json = JSON.stringify(stdioOrHttp(def.transport, "mcpServers"));
            const r = claudeMcpCli(["add-json", name, json, "-s", "user"]);
            if (!r.ok) throw new Error(`claude mcp add-json ${name}: ${r.error}`);
          }
        }
        return;
      }
      // fallback: хирургический мерж ~/.claude.json (только наши имена)
      await mergeJsonMap(
        path.join(homedir(), ".claude.json"),
        "mcpServers",
        managedNames,
        desired,
        (t) => stdioOrHttp(t, "mcpServers"),
      );
    },
  },
  {
    id: "codex-global",
    label: "Codex (~/.codex/config.toml)",
    runtimes: ["codex"],
    runtimeId: "codex",
    async apply(_repoRoot, state, managedNames) {
      const file = path.join(homedir(), ".codex", "config.toml");
      let text = "";
      try {
        text = await readFile(file, "utf8");
      } catch {
        text = "";
      }
      assertValidNames(managedNames);
      const desired = desiredFor(state, "codex");
      for (const name of managedNames) text = removeMcpSection(text, name);
      for (const [name, def] of desired) {
        const t = def.transport;
        text = upsertMcpSection(text, name, {
          command: t.type === "stdio" ? t.command : undefined,
          args: t.type === "stdio" ? t.args : undefined,
          env: t.type === "stdio" ? t.env : undefined,
          url: t.type === "http" ? t.url : undefined,
        });
      }
      await writeFile(file, text, "utf8");
    },
  },
  {
    id: "cursor-global",
    label: "Cursor (~/.cursor/mcp.json)",
    runtimes: ["cursor"],
    runtimeId: "cursor",
    async apply(_repoRoot, state, managedNames) {
      await mergeJsonMap(
        path.join(homedir(), ".cursor", "mcp.json"),
        "mcpServers",
        managedNames,
        desiredFor(state, "cursor"),
        (t) => stdioOrHttp(t, "mcpServers"),
      );
    },
  },
  {
    id: "opencode-global",
    label: "OpenCode (~/.config/opencode/opencode.jsonc)",
    runtimes: ["opencode"],
    runtimeId: "opencode",
    async apply(_repoRoot, state, managedNames) {
      await mergeJsonMap(
        path.join(homedir(), ".config", "opencode", "opencode.jsonc"),
        "mcp",
        managedNames,
        desiredFor(state, "opencode"),
        (t) => stdioOrHttp(t, "opencode"),
      );
    },
  },
];

/** Прогон всех таргетов; результат по каждому сохраняется в state.lastMcpSync. */
export async function syncMcp(repoRoot: string, state: ConsoleState): Promise<Record<string, TargetSyncResult>> {
  const at = new Date().toISOString();
  const results: Record<string, TargetSyncResult> = {};
  for (const target of targets) {
    const names = registryNames(state);
    assertValidNames(names);
    const desired = desiredFor(state, target.runtimeId);
    // таргет управляет текущими именами реестра И теми, что сам писал в прошлый
    // синк - иначе сервер, покинувший реестр (например, при выключении
    // плагина), навсегда остался бы в файлах
    const managed = new Set([...names, ...(state.lastMcpSync[target.id]?.applied ?? [])]);
    const managedNames = [...managed];
    const applied = [...desired.keys()];
    const removed = managedNames.filter((n) => !desired.has(n));
    const base = {
      target: target.id,
      label: target.label,
      runtimes: target.runtimes,
      at,
      applied,
      removed,
    };
    if (managedNames.length === 0 && !state.lastMcpSync[target.id]?.error) {
      // реестр пуст и таргет ничего не писал - файлы не изменяем, фиксируем статус
      results[target.id] = { ...base, ok: true };
      continue;
    }
    try {
      await target.apply(repoRoot, state, managedNames);
      results[target.id] = { ...base, ok: true };
    } catch (err) {
      results[target.id] = {
        ...base,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  state.lastMcpSync = results;
  return results;
}

export function mcpTargets(): Target[] {
  return targets;
}
