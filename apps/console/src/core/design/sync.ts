import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasManagedBlock, managedMarkers, removeManagedBlock, upsertManagedBlock } from "@/lib/managed-block";
import type { McpServerDef } from "@/core/types";
import { tokensSummary, type DesignPack } from "./workspace";

/**
 * Синхронизация дизайн-контекста в контекст рантаймов выбранной рабочей
 * директории. Канал - файлы папки: managed-блок harness-design в CLAUDE.md
 * (Claude Code читает @DESIGN.md и @BRAND.md импорты нативно) и в AGENTS.md
 * (OpenCode, Codex, ZCode, Kimi читают AGENTS.md; ключевые токены инлайнятся,
 * т.к. @-импорты там не гарантированы). MCP-серверы (open-design, figma)
 * попадают в рантаймы проектным .mcp.json - их пишет общий синк
 * core/mcp/sync.ts, здесь только статус.
 */

export const DESIGN_BLOCK_NAME = "harness-design";

/** Дизайн-MCP реестра консоли, относящиеся к дизайн-задачам. */
export const DESIGN_MCP_NAMES = ["open-design", "figma"];

export interface DesignSyncTarget {
  file: "CLAUDE.md" | "AGENTS.md";
  /** Файл существует и содержит managed-блок. */
  synced: boolean;
}

export interface DesignSyncStatus {
  targets: DesignSyncTarget[];
  /** Включённые дизайн-MCP из реестра. */
  enabledMcp: string[];
  /** Дизайн-MCP, отсутствующие в реестре или выключенные. */
  missingMcp: string[];
}

export interface DesignSyncResult {
  updated: string[];
  removed: string[];
  status: DesignSyncStatus;
}

function designMcpStatus(servers: Record<string, McpServerDef>): { enabledMcp: string[]; missingMcp: string[] } {
  const enabledMcp = DESIGN_MCP_NAMES.filter((name) => servers[name]?.enabled);
  return { enabledMcp, missingMcp: DESIGN_MCP_NAMES.filter((name) => !enabledMcp.includes(name)) };
}

function rulesSection(enabledMcp: string[]): string[] {
  const lines = [
    "Правила:",
    "- Код web и mobile ведётся по токенам DESIGN.md и примитивам кита проекта; хардкод цветов и радиусов не применяется.",
    "- Новые компоненты добавляются в кит проекта и в design/components.json (платформа web или mobile).",
    "- design/ui-kit.md старше этого блока не приоритетен: при расхождении источник истины - DESIGN.md.",
  ];
  lines.push(
    enabledMcp.length > 0
      ? `Дизайн-MCP этого проекта: ${enabledMcp.join(", ")} (проектный .mcp.json).`
      : "Дизайн-MCP (open-design, figma) не включены в реестре MCP консоли - работа с макетами через файлы пакета.",
  );
  return lines;
}

function claudeBlockContent(pack: DesignPack, enabledMcp: string[]): string {
  return [
    `# Дизайн-контекст Harness (${path.basename(pack.workspaceDir)})`,
    "",
    `Визуальная идентичность проекта: @DESIGN.md (формат @google/design.md: токены + гайд).`,
    `Бренд-паспорт проекта: @BRAND.md (имя, аудитория, тон коммуникации, фирменные элементы).`,
    `Правила интерфейса: design/ui-kit.md. Реестр компонентов: design/components.json (web и mobile).`,
    "",
    ...rulesSection(enabledMcp),
  ].join("\n");
}

function agentsBlockContent(pack: DesignPack, enabledMcp: string[]): string[] {
  const lines = [
    `# Дизайн-контекст Harness (${path.basename(pack.workspaceDir)})`,
    "",
    "Файлы дизайн-контекста этой папки:",
    "- DESIGN.md - визуальные токены (формат @google/design.md: front matter + гайд); прочитай его перед задачами интерфейса.",
    "- BRAND.md - бренд-паспорт (имя, аудитория, тон коммуникации, фирменные элементы); прочитай перед задачами бренда, текстов и интерфейса.",
    "- design/ui-kit.md - правила интерфейса web и mobile.",
    "- design/components.json - реестр компонентов проекта.",
  ];
  if (pack.design.tokens) {
    lines.push("", `Ключевые токены: ${tokensSummary(pack.design.tokens)}.`);
  }
  if (pack.brand.exists) {
    lines.push(`Бренд задан: имя и тон бери из BRAND.md; противоречия между BRAND.md и DESIGN.md решает BRAND.md в вопросах смысла, DESIGN.md - в вопросах значений токенов.`);
  }
  lines.push("", ...rulesSection(enabledMcp));
  return lines;
}

async function upsertFileBlock(dir: string, file: string, content: string): Promise<boolean> {
  const filePath = path.join(dir, file);
  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    /* файла нет - создаём с одним блоком */
  }
  const next = upsertManagedBlock(current, DESIGN_BLOCK_NAME, content);
  if (next === current) return false;
  await atomicWrite(filePath, next);
  return true;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/** Записать managed-блоки в CLAUDE.md и AGENTS.md рабочей папки. */
export async function syncDesignContext(
  dir: string,
  pack: DesignPack,
  mcpServers: Record<string, McpServerDef>,
): Promise<DesignSyncResult> {
  const { enabledMcp, missingMcp } = designMcpStatus(mcpServers);
  const updated: string[] = [];
  if (await upsertFileBlock(dir, "CLAUDE.md", claudeBlockContent(pack, enabledMcp))) updated.push("CLAUDE.md");
  if (await upsertFileBlock(dir, "AGENTS.md", agentsBlockContent(pack, enabledMcp).join("\n"))) updated.push("AGENTS.md");
  const status = await designSyncStatus(dir, mcpServers);
  return { updated, removed: [], status };
}

/** Удалить managed-блоки из CLAUDE.md и AGENTS.md рабочей папки. */
export async function removeDesignContext(dir: string, mcpServers: Record<string, McpServerDef>): Promise<DesignSyncResult> {
  const removed: string[] = [];
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const filePath = path.join(dir, file);
    let current: string;
    try {
      current = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const next = removeManagedBlock(current, DESIGN_BLOCK_NAME);
    if (next === current) continue;
    await atomicWrite(filePath, next);
    removed.push(file);
  }
  const status = await designSyncStatus(dir, mcpServers);
  return { updated: [], removed, status };
}

/** Статус синхронизации папки: managed-блоки + включённые дизайн-MCP. */
export async function designSyncStatus(dir: string, mcpServers: Record<string, McpServerDef>): Promise<DesignSyncStatus> {
  const targets: DesignSyncTarget[] = [];
  for (const file of ["CLAUDE.md", "AGENTS.md"] as const) {
    let synced = false;
    try {
      synced = hasManagedBlock(await readFile(path.join(dir, file), "utf8"), DESIGN_BLOCK_NAME);
    } catch {
      /* файла нет */
    }
    targets.push({ file, synced });
  }
  const { enabledMcp, missingMcp } = designMcpStatus(mcpServers);
  return { targets, enabledMcp, missingMcp };
}

/** Экспорт для тестов: маркеры блока дизайн-слоя. */
export const designBlockMarkers = () => managedMarkers(DESIGN_BLOCK_NAME);
