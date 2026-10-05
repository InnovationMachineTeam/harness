import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type RuntimeId = "claude" | "codex" | "zcode" | "cursor" | "kimi";

export interface HookEntry {
  event: string;
  matcher: string | null;
  sub: string;
  timeout: number;
}

// Единый источник списка хуков индексов (N-3). Файлы хуков рантаймов только
// вызывают обёртку cli.ts; прямые вызовы CLI запрещены (проверяет validate:hooks).
// Codex без записей: additionalContext отклоняется - правила в AGENTS.md (S-4, G-4).
// OpenCode - без декларативных хуков: политика в плагине, правила в AGENTS.md.
export const WRAPPER_MARKER = "tooling/harness/src/cli.ts";
const INDEX_TOOL_RE = /\b(codegraph|graphify|serena-hooks)\b/;

export interface RuntimeWiring {
  id: RuntimeId;
  file: string;
  entries: HookEntry[];
  command: (sub: string) => string;
}

function wrapperCommand(sub: string, dirVar: string): string {
  return `command -v bun >/dev/null 2>&1 && bun "\${${dirVar}}/${WRAPPER_MARKER}" ${sub} || exit 0`;
}

function kimiCommand(sub: string): string {
  return `sh -c 'if [ -f ${WRAPPER_MARKER} ] && command -v bun >/dev/null 2>&1; then exec bun ${WRAPPER_MARKER} ${sub}; else exit 0; fi'`;
}

const PRETOOL: Array<{ sub: string; matcher: string }> = [
  { sub: "graphify guard-search", matcher: "Bash|Grep" },
  { sub: "graphify guard-read", matcher: "Read|Glob" },
  { sub: "serena remind", matcher: "Read|Grep" },
];

export const RUNTIMES: RuntimeWiring[] = [
  {
    id: "claude",
    file: ".claude/settings.json",
    command: (sub) => wrapperCommand(sub, "CLAUDE_PROJECT_DIR"),
    entries: [
      ...PRETOOL.map((g) => ({ event: "PreToolUse", matcher: g.matcher, sub: g.sub, timeout: 10 })),
      { event: "UserPromptSubmit", matcher: null, sub: "codegraph prompt-hook", timeout: 10 },
      { event: "SessionStart", matcher: "startup|resume", sub: "serena session-start", timeout: 10 },
      { event: "SessionEnd", matcher: null, sub: "serena session-end", timeout: 10 },
    ],
  },
  {
    id: "zcode",
    file: ".zcode/config.json",
    command: (sub) => wrapperCommand(sub, "ZCODE_PROJECT_DIR"),
    entries: [
      ...PRETOOL.map((g) => ({ event: "PreToolUse", matcher: g.matcher, sub: g.sub, timeout: 10 })),
      { event: "UserPromptSubmit", matcher: null, sub: "codegraph prompt-hook", timeout: 10 },
      { event: "SessionStart", matcher: null, sub: "serena session-start", timeout: 10 },
    ],
  },
  {
    id: "cursor",
    file: ".cursor/hooks.json",
    command: (sub) => wrapperCommand(sub, "CURSOR_PROJECT_DIR"),
    // формат без матчеров: один агрегатор на все инструменты
    entries: [{ event: "preToolUse", matcher: null, sub: "pretooluse", timeout: 10 }],
  },
  {
    id: "kimi",
    file: ".kimi/config.toml",
    command: kimiCommand,
    entries: PRETOOL.map((g) => ({ event: "PreToolUse", matcher: g.matcher, sub: g.sub, timeout: 10 })),
  },
  { id: "codex", file: ".codex/hooks.json", command: () => "", entries: [] },
];

interface HookConfig {
  type: "command";
  command: string;
  timeout?: number;
}

interface EventConfig {
  matcher?: string;
  hooks: HookConfig[];
}

interface GroupFile {
  hooks?: { events?: Record<string, EventConfig[] | undefined> } & Record<string, unknown>;
  [key: string]: unknown;
}

function commandsOf(entry: EventConfig | undefined): string[] {
  return (entry?.hooks ?? []).map((hook) => hook.command);
}

function isWrapperCommand(command: string): boolean {
  return command.includes(WRAPPER_MARKER);
}

function isIndexCommand(command: string): boolean {
  return INDEX_TOOL_RE.test(command);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// Проверка соответствия файлов хуков реестру. Возврат - список расхождений.
export function docsCheck(root: string): string[] {
  const problems: string[] = [];
  for (const runtime of RUNTIMES) {
    const path = join(root, runtime.file);
    if (!existsSync(path)) {
      if (runtime.entries.length) problems.push(`${runtime.id}: ${runtime.file} отсутствует`);
      continue;
    }
    if (runtime.id === "claude" || runtime.id === "zcode") {
      const file = readJson(path) as GroupFile;
      const events = runtime.id === "zcode" ? file.hooks?.events ?? {} : file.hooks ?? {};
      checkGroups(problems, runtime, events);
    } else if (runtime.id === "cursor") {
      const file = readJson(path) as { hooks?: { preToolUse?: Array<{ command: string; timeout?: number }> } };
      checkFlat(problems, runtime, file.hooks?.preToolUse ?? []);
    } else if (runtime.id === "kimi") {
      checkKimi(problems, runtime, readFileSync(path, "utf8"));
    } else if (runtime.id === "codex") {
      const file = readJson(path) as GroupFile;
      for (const [event, groups] of Object.entries(file.hooks ?? {})) {
        for (const group of (groups as EventConfig[]) ?? []) {
          for (const command of commandsOf(group)) {
            if (isIndexCommand(command)) {
              problems.push(`codex: вызов индексного инструмента в ${event}: ${command} (S-4, G-4 - только правила в AGENTS.md)`);
            }
          }
        }
      }
    }
  }
  return problems;
}

function checkGroups(problems: string[], runtime: RuntimeWiring, events: Record<string, EventConfig[] | undefined>): void {
  for (const entry of runtime.entries) {
    const group = (events[entry.event] ?? []).find(
      (item) =>
        (item.matcher ?? null) === entry.matcher &&
        commandsOf(item).some((command) => command.includes(entry.sub) && isWrapperCommand(command)),
    );
    if (!group) {
      problems.push(`${runtime.id}: нет записи ${entry.event} ${entry.sub}`);
      continue;
    }
    const hook = group.hooks.find((item) => item.command === runtime.command(entry.sub));
    if (!hook) {
      problems.push(`${runtime.id}: команда ${entry.sub} отличается от реестра`);
    } else if (hook.timeout !== entry.timeout || (group.matcher ?? null) !== entry.matcher) {
      problems.push(`${runtime.id}: matcher/timeout ${entry.sub} отличается от реестра`);
    }
  }
  for (const [event, groups] of Object.entries(events)) {
    for (const group of groups ?? []) {
      for (const command of commandsOf(group)) {
        if (isIndexCommand(command) && !isWrapperCommand(command)) {
          problems.push(`${runtime.id}: прямой вызов в ${event}: ${command}`);
        }
      }
    }
  }
}

function checkFlat(problems: string[], runtime: RuntimeWiring, items: Array<{ command: string; timeout?: number }>): void {
  for (const entry of runtime.entries) {
    const expected = runtime.command(entry.sub);
    const item = items.find((candidate) => candidate.command === expected);
    if (!item) {
      problems.push(`${runtime.id}: нет записи ${entry.sub}`);
    } else if (item.timeout !== entry.timeout) {
      problems.push(`${runtime.id}: timeout ${entry.sub} отличается от реестра`);
    }
  }
  for (const item of items) {
    if (isIndexCommand(item.command) && !isWrapperCommand(item.command)) {
      problems.push(`${runtime.id}: прямой вызов: ${item.command}`);
    }
  }
}

interface KimiBlock {
  event?: string;
  matcher?: string;
  command?: string;
}

function parseKimi(text: string): { header: string; blocks: KimiBlock[]; rawBlocks: string[][] } {
  const lines = text.split("\n");
  const headerLines: string[] = [];
  const rawBlocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.trim() === "[[hooks]]") {
      current = [];
      rawBlocks.push(current);
      continue;
    }
    if (current) current.push(line);
    else headerLines.push(line);
  }
  const blocks = rawBlocks.map((block) => ({
    event: blockField(block, "event"),
    matcher: blockField(block, "matcher"),
    command: blockField(block, "command"),
  }));
  return { header: headerLines.join("\n"), blocks, rawBlocks };
}

function blockField(block: string[], key: string): string | undefined {
  const line = block.find((candidate) => candidate.startsWith(`${key} =`));
  if (!line) return undefined;
  const match = line.match(/^\w+\s*=\s*"(.*)"\s*$/);
  return match ? match[1] : undefined;
}

function checkKimi(problems: string[], runtime: RuntimeWiring, text: string): void {
  const { blocks } = parseKimi(text);
  for (const entry of runtime.entries) {
    const block = blocks.find(
      (candidate) => candidate.event === entry.event && (candidate.matcher ?? null) === entry.matcher && candidate.command === runtime.command(entry.sub),
    );
    if (!block) problems.push(`${runtime.id}: нет записи ${entry.event} ${entry.sub}`);
  }
  for (const block of blocks) {
    if (block.command && isIndexCommand(block.command) && !isWrapperCommand(block.command)) {
      problems.push(`${runtime.id}: прямой вызов: ${block.command}`);
    }
  }
}

function writeGroups(events: Record<string, EventConfig[] | undefined>, runtime: RuntimeWiring): void {
  const eventsUsed = [...new Set(runtime.entries.map((entry) => entry.event))];
  for (const event of eventsUsed) {
    const groups = events[event] ?? [];
    // удаляются записи обёртки и легаси-прямые вызовы индексных инструментов
    events[event] = groups.filter((group) => !commandsOf(group).some((command) => isWrapperCommand(command) || isIndexCommand(command)));
  }
  for (const entry of runtime.entries) {
    const config: EventConfig = { hooks: [{ type: "command", command: runtime.command(entry.sub), timeout: entry.timeout }] };
    if (entry.matcher !== null) config.matcher = entry.matcher;
    events[entry.event]!.push(config);
  }
}

// Приведение файлов хуков к реестру: чужие записи не трогаются, записи
// обёртки пересоздаются, в codex вызовы индексных инструментов удаляются.
export function docsWrite(root: string): void {
  for (const runtime of RUNTIMES) {
    const path = join(root, runtime.file);
    if (!existsSync(path)) continue;

    if (runtime.id === "claude" || runtime.id === "zcode") {
      const file = readJson(path) as GroupFile;
      if (!file.hooks) file.hooks = {};
      if (runtime.id === "zcode" && !file.hooks.events) file.hooks.events = {};
      const events = runtime.id === "zcode" ? file.hooks.events! : (file.hooks as Record<string, EventConfig[] | undefined>);
      writeGroups(events, runtime);
      writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    } else if (runtime.id === "cursor") {
      const file = readJson(path) as { hooks?: { preToolUse?: Array<Record<string, unknown>> } };
      if (!file.hooks) file.hooks = {};
      if (!file.hooks.preToolUse) file.hooks.preToolUse = [];
      const kept = file.hooks.preToolUse.filter((item) => {
        const command = String(item.command ?? "");
        return !isWrapperCommand(command) && !isIndexCommand(command);
      });
      for (const entry of runtime.entries) {
        kept.push({ command: runtime.command(entry.sub), timeout: entry.timeout, failClosed: false });
      }
      file.hooks.preToolUse = kept;
      writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    } else if (runtime.id === "kimi") {
      const text = readFileSync(path, "utf8");
      const { header, rawBlocks } = parseKimi(text);
      const kept = rawBlocks.filter((block) => {
        const command = blockField(block, "command") ?? "";
        return !isWrapperCommand(command) && !isIndexCommand(command);
      });
      for (const entry of runtime.entries) {
        kept.push([
          `event = "${entry.event}"`,
          `matcher = "${entry.matcher}"`,
          `command = "${runtime.command(entry.sub)}"`,
          `timeout = ${entry.timeout}`,
        ]);
      }
      const body = kept.map((block) => ["[[hooks]]", ...block].join("\n")).join("\n");
      writeFileSync(path, header + (header.endsWith("\n") || !header ? "" : "\n") + "\n" + body + "\n");
    } else if (runtime.id === "codex") {
      const file = readJson(path) as GroupFile;
      if (!file.hooks) file.hooks = {};
      for (const [event, groups] of Object.entries(file.hooks as Record<string, EventConfig[] | undefined>)) {
        file.hooks[event] = (groups ?? []).filter((group) => !commandsOf(group).some((command) => isIndexCommand(command)));
      }
      writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    }
  }
}
