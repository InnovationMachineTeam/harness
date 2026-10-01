import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { lint } from "@google/design.md/linter";
import { buildDesignFile, parseDesign, validateThemeName, validateTokens } from "@/lib/design-format";
import { COLOR_ROLES, matchPreset, roleToKebab, type ThemeMode, type ThemeTokens } from "@/lib/themes";

/**
 * Серверный слой DESIGN.md (спека @google/design.md): чтение/запись токенов,
 * lint, атомарная запись и bake CSS-переменных в managed-блок globals.css.
 * Тёмная тема - DESIGN.md, светлая - DESIGN.light.md (оба "над" папкой themes/).
 * Папка themes/ хранит файлы пресетов (dark-*.md / light-*.md): настройки и
 * описание каждой темы; в рантайме читаются лениво, при сохранении не меняются.
 */

export interface DesignFile {
  /** Токены слота (роли camelCase + радиусы). */
  tokens: ThemeTokens;
  /** Имя темы из front matter. */
  name: string;
  /** Полное содержимое файла (для предпросмотра на вкладке Design). */
  content: string;
  exists: boolean;
}

export interface DesignState {
  dark: DesignFile;
  light: DesignFile;
}

export interface ThemeIndexEntry {
  /** Имя файла в папке themes/, например dark-dracula.md. */
  file: string;
  name: string;
  mode: ThemeMode;
}

export type DesignSlotPayload = { tokens: ThemeTokens; name?: string };

export interface LintFinding {
  rule: string;
  severity: string;
  message: string;
}

export function designFilePaths(repoRoot: string): { dark: string; light: string; globalsCss: string; themesDir: string } {
  return {
    dark: path.join(repoRoot, "DESIGN.md"),
    light: path.join(repoRoot, "DESIGN.light.md"),
    globalsCss: path.join(repoRoot, "apps", "console", "src", "app", "globals.css"),
    themesDir: path.join(repoRoot, "themes"),
  };
}

/** Индекс папки themes/: имя файла, название и режим каждой темы-пресета. */
export async function listThemeFiles(repoRoot: string): Promise<ThemeIndexEntry[]> {
  const { themesDir } = designFilePaths(repoRoot);
  let entries: string[];
  try {
    entries = await readdir(themesDir);
  } catch {
    return [];
  }
  const index: ThemeIndexEntry[] = [];
  for (const file of entries.sort()) {
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(file)) continue;
    const mode: ThemeMode = file.startsWith("light-") ? "light" : "dark";
    try {
      const content = await readFile(path.join(themesDir, file), "utf8");
      index.push({ file, name: parseDesign(content).name, mode });
    } catch {
      continue;
    }
  }
  return index;
}

/** Чтение файла пресета из themes/ (для ленивого предпросмотра на клиенте). */
export async function readThemeFile(repoRoot: string, file: string): Promise<{ content: string; name: string } | { error: string }> {
  if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(file)) return { error: "некорректное имя файла темы" };
  const { themesDir } = designFilePaths(repoRoot);
  const known = await listThemeFiles(repoRoot);
  if (!known.some((entry) => entry.file === file)) return { error: "файл темы не найден в themes/" };
  try {
    const content = await readFile(path.join(themesDir, file), "utf8");
    return { content, name: parseDesign(content).name };
  } catch {
    return { error: "файл темы не читается" };
  }
}

export async function readDesignSlot(file: string, fallback: ThemeTokens): Promise<DesignFile> {
  try {
    const content = await readFile(file, "utf8");
    const { name, tokens } = parseDesign(content);
    return { tokens, name, content, exists: true };
  } catch {
    return { tokens: fallback, name: "Graphite", content: "", exists: false };
  }
}

export async function loadDesign(repoRoot: string, fallback: { dark: ThemeTokens; light: ThemeTokens }): Promise<DesignState> {
  const paths = designFilePaths(repoRoot);
  const [dark, light] = await Promise.all([
    readDesignSlot(paths.dark, fallback.dark),
    readDesignSlot(paths.light, fallback.light),
  ]);
  return { dark, light };
}

/** Lint содержимого DESIGN-файла; неразбираемый документ - одна error-finding. */
export function lintDesign(content: string): { findings: LintFinding[]; errors: number; warnings: number } {
  try {
    const report = lint(content);
    const findings: LintFinding[] = report.findings.map((f) => ({
      rule: String(f.rule ?? "unknown"),
      severity: String(f.severity),
      message: String(f.message ?? ""),
    }));
    return {
      findings,
      errors: report.summary.errors,
      warnings: report.summary.warnings,
    };
  } catch (cause) {
    return {
      findings: [{ rule: "parse", severity: "error", message: `не удалось разобрать DESIGN.md: ${String(cause)}` }],
      errors: 1,
      warnings: 0,
    };
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/**
 * Сохранение слота: пересборка front matter; имя - по совпавшему пресету,
 * иначе клиентское "<База> (Custom)" (nameHint) или просто "Custom".
 * Ошибки линта запрещают запись.
 */
export async function saveDesignSlot(
  repoRoot: string,
  mode: ThemeMode,
  tokens: ThemeTokens,
  nameHint?: string,
): Promise<{ ok: boolean; warnings: number; findings: LintFinding[]; name: string; error?: string }> {
  const paths = designFilePaths(repoRoot);
  const file = mode === "dark" ? paths.dark : paths.light;
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    return { ok: false, warnings: 0, findings: [], name: "", error: `${path.basename(file)} не найден в корне репозитория` };
  }
  const preset = matchPreset(mode, tokens);
  const themeName = preset ? preset.name : validateThemeName(nameHint) ?? "Custom";
  const next = buildDesignFile(current, tokens, themeName);
  const report = lintDesign(next);
  if (report.errors > 0) {
    return { ok: false, warnings: report.warnings, findings: report.findings, name: themeName, error: "lint нашёл ошибки" };
  }
  await atomicWrite(file, next);
  return { ok: true, warnings: report.warnings, findings: report.findings, name: themeName };
}

const TOKENS_START = "/* design-tokens:start */";
const TOKENS_END = "/* design-tokens:end */";

function cssColorBlock(selector: string, tokens: ThemeTokens): string {
  const lines = [
    ...COLOR_ROLES.map((role) => `  --design-${roleToKebab(role)}: ${tokens.colors[role]};`),
    `  --design-radius-md: ${tokens.rounded.md};`,
    `  --design-radius-lg: ${tokens.rounded.lg};`,
    `  --design-radius-xl: ${tokens.rounded.xl};`,
  ];
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/**
 * Bake в source CSS: переписывает managed-блок в globals.css значениями
 * из DESIGN-файлов, чтобы SSR-кадр всегда был раскрашен актуальной темой.
 */
export async function bakeGlobalsCss(repoRoot: string, dark: ThemeTokens, light: ThemeTokens): Promise<boolean> {
  const paths = designFilePaths(repoRoot);
  let css: string;
  try {
    css = await readFile(paths.globalsCss, "utf8");
  } catch {
    return false;
  }
  const start = css.indexOf(TOKENS_START);
  const end = css.indexOf(TOKENS_END);
  if (start === -1 || end === -1 || end < start) return false;
  const block = [
    TOKENS_START,
    cssColorBlock(":root,\n[data-theme=\"dark\"]", dark),
    cssColorBlock("[data-theme=\"light\"]", light),
    TOKENS_END,
  ].join("\n");
  await atomicWrite(paths.globalsCss, css.slice(0, start) + block + css.slice(end + TOKENS_END.length));
  return true;
}
