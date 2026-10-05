import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { lintDesign, readThemeFile, type LintFinding } from "../design";
import { buildDesignFile, FRONT_MATTER_RE, parseDesign, validateThemeName } from "@/lib/design-format";
import { matchPreset, roleToKebab, type ThemeMode, type ThemeTokens } from "@/lib/themes";

/**
 * Design pack рабочей папки: DESIGN.md (формат @google/design.md), бренд-паспорт
 * BRAND.md, правила интерфейса design/ui-kit.md и реестр компонентов
 * design/components.json (web и mobile). Пакет - единственный источник
 * дизайн-контекста для рантаймов: файлы читают Claude Code и OpenCode из своей
 * рабочей директории, синхронизация в контекст - core/design/sync.ts.
 */

export interface DesignPackDesign {
  exists: boolean;
  name: string;
  tokens: ThemeTokens | null;
  content: string;
  lintErrors: number;
  lintWarnings: number;
}

export interface DesignPackTextFile {
  exists: boolean;
  content: string;
}

export interface ComponentsEntry {
  name: string;
  path: string;
}

export interface ComponentsManifest {
  version: 1;
  updated: string;
  web: ComponentsEntry[];
  mobile: ComponentsEntry[];
}

export interface DesignPack {
  workspaceDir: string;
  design: DesignPackDesign;
  uikit: DesignPackTextFile;
  brand: DesignPackTextFile;
  components: { exists: boolean; manifest: ComponentsManifest | null };
}

export function designPackPaths(dir: string): {
  design: string;
  designDir: string;
  uikit: string;
  brand: string;
  components: string;
} {
  return {
    design: path.join(dir, "DESIGN.md"),
    designDir: path.join(dir, "design"),
    uikit: path.join(dir, "design", "ui-kit.md"),
    brand: path.join(dir, "BRAND.md"),
    components: path.join(dir, "design", "components.json"),
  };
}

const DESIGN_READ_CAP = 256_000;
const TEXT_READ_CAP = 128_000;

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/* --------------------------------- шаблоны --------------------------------- */

/** Тело DESIGN.md при создании с нуля (front matter пересобирается из токенов). */
const DESIGN_BODY_TEMPLATE = `
# Визуальная идентичность проекта

Файл описывает дизайн-токены проекта в формате @google/design.md: front matter - машинные значения, этот раздел - гайд для кодинг-агентов.

## Гайд

- Все цвета интерфейса берутся из front matter (роли colors); хардкод hex в компонентах не применяется.
- Скругления - три ступени rounded: md для контролов, lg для панелей, xl для модалок.
- Семантика ролей: page/surface/raised/overlay - фоны по глубине; line/lineStrong - границы; fg/fgMuted/fgFaint - текст по убыванию важности; accent - действия; info/warning/danger - статусы.
- Дополняйте этот раздел правилами проекта: типографика, отступы, тени.
`.trim() + "\n";

const UIKIT_TEMPLATE = `# UI-kit проекта

Правила интерфейса для web и mobile. Источник токенов - DESIGN.md в корне; реестр компонентов - design/components.json.

## Общие правила

- Примитивы интерфейса живут в одном модуле кита; экраны собираются только из примитивов кита.
- Новые визуальные свойства вводятся через токены DESIGN.md, а не отдельными значениями.
- Компонент, появившийся в коде, добавляется в design/components.json (платформа web или mobile).

## Web

- Стек по умолчанию: React + Tailwind; цвета и радиусы - семантические классы из токенов проекта.
- Нативные элементы форм используются только внутри примитивов кита.

## Mobile

- Стек по умолчанию: React Native; отступы и скругления - StyleSheet из токенов проекта.
- Платформенные различия изолируются в примитиве, а не на экране.
`;

const BRAND_TEMPLATE = `# Бренд

Паспорт бренда проекта: смысловой слой визуальной идентичности. Числовые значения цветов и радиусов - только в DESIGN.md; здесь - смысл и правила коммуникации. Заполняется вручную или задачей дизайн-раннера (например, из артефактов open-design).

## Имя и суть

- Имя:
- Суть (одно предложение):

## Аудитория

- Основные сегменты:

## Тон коммуникации

- Характер обращений (на "ты"/на "вы"), стиль формулировок:

## Фирменные элементы

- Логотип и правила использования:
- Типографика (гарфты, начертания):
- Референсы:
`;

function componentsScaffold(): ComponentsManifest {
  return { version: 1, updated: new Date().toISOString(), web: [], mobile: [] };
}

/* ------------------------------ чтение пакета ------------------------------ */

function parseManifest(raw: string): ComponentsManifest | null {
  try {
    const value = JSON.parse(raw) as Partial<ComponentsManifest>;
    if (!value || typeof value !== "object") return null;
    const pick = (entries: unknown): ComponentsEntry[] =>
      Array.isArray(entries)
        ? entries
            .filter((e): e is ComponentsEntry => {
              const item = e as Partial<ComponentsEntry>;
              return typeof item?.name === "string" && item.name.trim().length > 0 && typeof item?.path === "string";
            })
            .map((e) => ({ name: e.name.trim().slice(0, 120), path: e.path.trim().slice(0, 400) }))
        : [];
    return { version: 1, updated: typeof value.updated === "string" ? value.updated : "", web: pick(value.web), mobile: pick(value.mobile) };
  } catch {
    return null;
  }
}

/** Прочитать design pack рабочей папки; отсутствующие файлы - exists: false. */
export async function loadDesignPack(dir: string): Promise<DesignPack> {
  const paths = designPackPaths(dir);
  const [designRaw, uikitRaw, brandRaw, componentsRaw] = await Promise.all([
    readFile(paths.design, "utf8").catch(() => null),
    readFile(paths.uikit, "utf8").catch(() => null),
    readFile(paths.brand, "utf8").catch(() => null),
    readFile(paths.components, "utf8").catch(() => null),
  ]);

  let design: DesignPackDesign = { exists: false, name: "", tokens: null, content: "", lintErrors: 0, lintWarnings: 0 };
  if (designRaw !== null) {
    const parsed = parseDesign(designRaw);
    const lint = lintDesign(designRaw);
    design = {
      exists: true,
      name: parsed.name,
      tokens: parsed.tokens,
      content: designRaw.slice(0, DESIGN_READ_CAP),
      lintErrors: lint.errors,
      lintWarnings: lint.warnings,
    };
  }

  return {
    workspaceDir: dir,
    design,
    uikit: { exists: uikitRaw !== null, content: (uikitRaw ?? "").slice(0, TEXT_READ_CAP) },
    brand: { exists: brandRaw !== null, content: (brandRaw ?? "").slice(0, TEXT_READ_CAP) },
    components: { exists: componentsRaw !== null, manifest: componentsRaw !== null ? parseManifest(componentsRaw) : null },
  };
}

/* ------------------------------ запись пакета ------------------------------ */

/**
 * Создать DESIGN.md из пресета themes/ консоли + служебные файлы пакета
 * (ui-kit.md, components.json), если их нет. Существующий DESIGN.md не
 * перезаписывается (overwrite - явное разрешение).
 */
export async function createDesignPack(
  repoRoot: string,
  dir: string,
  presetFile: string,
  opts: { overwrite?: boolean } = {},
): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  const preset = await readThemeFile(repoRoot, presetFile);
  if ("error" in preset) return { ok: false, error: preset.error };
  const paths = designPackPaths(dir);
  const files: string[] = [];

  let currentDesign: string | null = null;
  try {
    currentDesign = await readFile(paths.design, "utf8");
  } catch {
    /* файла нет - создаём */
  }
  if (currentDesign !== null && !opts.overwrite) {
    return { ok: false, error: "DESIGN.md уже существует в рабочей папке (overwrite не передан)" };
  }
  if (currentDesign !== preset.content) {
    await atomicWrite(paths.design, preset.content);
    files.push("DESIGN.md");
  }

  await mkdir(paths.designDir, { recursive: true });
  for (const [file, content] of [
    [paths.uikit, UIKIT_TEMPLATE],
    [paths.brand, BRAND_TEMPLATE],
    [paths.components, `${JSON.stringify(componentsScaffold(), null, 2)}\n`],
  ] as const) {
    if (await readFile(file, "utf8").then(() => true).catch(() => false)) continue;
    await atomicWrite(file, content);
    files.push(path.relative(dir, file));
  }
  return { ok: true, files: files.length ? files : ["файлы пакета без изменений"] };
}

/** Сохранение DESIGN.md из токенов: front matter пересобирается, тело сохраняется. */
export async function saveWorkspaceDesign(
  dir: string,
  tokens: ThemeTokens,
  nameHint?: string,
): Promise<{ ok: true; name: string; warnings: number; findings: LintFinding[] } | { ok: false; error: string; findings: LintFinding[] }> {
  const paths = designPackPaths(dir);
  let current: string;
  try {
    current = await readFile(paths.design, "utf8");
  } catch {
    current = DESIGN_BODY_TEMPLATE;
  }
  const preset = matchPreset("dark", tokens) ?? matchPreset("light", tokens);
  const name = (preset && preset.name) || validateThemeName(nameHint) || "Custom";
  const next = buildDesignFile(current, tokens, name);
  const lint = lintDesign(next);
  if (lint.errors > 0) return { ok: false, error: "lint нашёл ошибки в собранном DESIGN.md", findings: lint.findings };
  await atomicWrite(paths.design, next);
  return { ok: true, name, warnings: lint.warnings, findings: lint.findings };
}

/** Записать design/ui-kit.md (правила интерфейса ведут рантаймы или пользователь). */
export async function saveWorkspaceUikit(dir: string, content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("содержимое ui-kit.md пустое");
  await atomicWrite(designPackPaths(dir).uikit, `${trimmed}\n`);
}

/**
 * Сохранение гайда (markdown-тела) DESIGN.md: front matter с токенами остаётся
 * без изменений, заменяется только раздел после front matter. Ошибки линта
 * запрещают запись.
 */
export async function saveWorkspaceDesignGuide(
  dir: string,
  body: string,
): Promise<{ ok: true; warnings: number; findings: LintFinding[] } | { ok: false; error: string; findings: LintFinding[] }> {
  const paths = designPackPaths(dir);
  let current: string;
  try {
    current = await readFile(paths.design, "utf8");
  } catch {
    return { ok: false, error: "DESIGN.md не найден в рабочей папке - сначала создайте пакет", findings: [] };
  }
  const m = current.match(FRONT_MATTER_RE);
  const next = `${m ? m[0] : ""}${body}`;
  const lint = lintDesign(next);
  if (lint.errors > 0) return { ok: false, error: "lint нашёл ошибки в DESIGN.md", findings: lint.findings };
  await atomicWrite(paths.design, next);
  return { ok: true, warnings: lint.warnings, findings: lint.findings };
}

/** Записать BRAND.md (бренд-паспорт; формат свободный, шаблон - BRAND_TEMPLATE). */
export async function saveWorkspaceBrand(dir: string, content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("содержимое BRAND.md пустое");
  await atomicWrite(designPackPaths(dir).brand, `${trimmed}\n`);
}

/** Скелет BRAND.md (для кнопки "Создать по шаблону" во вкладке Дизайн). */
export function brandTemplate(): string {
  return BRAND_TEMPLATE;
}

/** Скелет design/ui-kit.md (для кнопки "Создать по шаблону" редактора UIKit). */
export function uikitTemplate(): string {
  return UIKIT_TEMPLATE;
}

/** Записать design/components.json после валидации. */
export async function saveComponentsManifest(dir: string, manifest: ComponentsManifest): Promise<void> {
  const payload: ComponentsManifest = { ...manifest, version: 1, updated: new Date().toISOString() };
  await atomicWrite(designPackPaths(dir).components, `${JSON.stringify(payload, null, 2)}\n`);
}

/* --------------------------- сканирование компонентов --------------------------- */

const WEB_DIRS = [
  "src/components",
  "components",
  "src/uikit/components",
  "src/uikit",
  "uikit",
  "app/components",
  "src/app/components",
  "apps/console/src/uikit/components",
  "packages/ui/src",
];
const MOBILE_DIRS = ["components/mobile", "src/components/mobile", "packages/ui-mobile/src", "mobile/components", "app/mobile/components"];
const COMPONENT_EXT = /\.(tsx|ts)$/;
const COMPONENT_EXCLUDE = /\.(test|stories)\.[a-z]+$/;
const INDEX_FILE = /^index\.[a-z]+$/;

/** Компоненты одного каталога: имя файла = имя компонента (PascalCase); index.* в PascalCase-папке - компонент-папка (имя = папка). */
async function scanDirForComponents(root: string, relDir: string, collected: ComponentsEntry[]): Promise<void> {
  const absolute = path.join(root, relDir);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(absolute, { recursive: true, withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !COMPONENT_EXT.test(entry.name) || COMPONENT_EXCLUDE.test(entry.name)) continue;
    const parent = entry.parentPath ?? path.dirname(path.join(absolute, entry.name));
    const parentName = path.basename(parent);
    const name = INDEX_FILE.test(entry.name) ? parentName : entry.name.replace(COMPONENT_EXT, "");
    if (!/^[A-Z]/.test(name)) continue;
    const abs = path.join(parent, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (collected.some((item) => item.path === rel)) continue;
    collected.push({ name, path: rel });
    if (collected.length >= 200) return;
  }
}

/**
 * Первичное заполнение манифеста сканированием типовых каталогов проекта:
 * web - общие каталоги компонентов, mobile - каталоги с mobile в пути.
 * Манифест дальше ведут рантаймы (задачи дизайн-раннера).
 */
export async function scanWorkspaceComponents(dir: string): Promise<ComponentsManifest> {
  const web: ComponentsEntry[] = [];
  const mobile: ComponentsEntry[] = [];
  for (const rel of WEB_DIRS) await scanDirForComponents(dir, rel, web);
  for (const rel of MOBILE_DIRS) await scanDirForComponents(dir, rel, mobile);
  const mobileLike = /(^|\/)mobile\//;
  const byName = (a: ComponentsEntry, b: ComponentsEntry) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
  return {
    version: 1,
    updated: new Date().toISOString(),
    web: web.filter((item) => !mobileLike.test(item.path)).sort(byName),
    mobile: mobile.sort(byName),
  };
}

/** Каталоги модуля кита проекта в порядке приоритета; компоненты кита - в папке components (папка с index.* = компонент). */
const KIT_DIRS = ["apps/console/src/uikit", "src/uikit", "src/ui", "uikit"];

/**
 * Регистрация модуля кита в design/components.json: компоненты-папки
 * (<kit>/components/<Name>/index.tsx - имя = папка; сканер тоже собирает их,
 * register-kit покрывает случаи, когда каталог кита вне типовых WEB_DIRS) и,
 * при плоском layout, PascalCase-файлы в корне кита (index.* - точка входа
 * с именем "UIKit").
 */
export async function registerWorkspaceKit(
  dir: string,
): Promise<{ ok: true; added: ComponentsEntry[]; kitDir: string; manifest: ComponentsManifest } | { ok: false; error: string }> {
  const root = path.resolve(dir);
  let kitDir: string | null = null;
  for (const rel of KIT_DIRS) {
    const isDir = await stat(path.join(root, rel)).then((entry) => entry.isDirectory()).catch(() => false);
    if (isDir) {
      kitDir = rel;
      break;
    }
  }
  if (!kitDir) return { ok: false, error: "каталог кита не найден (apps/console/src/uikit, src/uikit, src/ui, uikit)" };

  const componentsRoot = path.join(root, kitDir, "components");
  const folderLayout = await stat(componentsRoot).then((entry) => entry.isDirectory()).catch(() => false);
  const added: ComponentsEntry[] = [];
  if (folderLayout) {
    const groups = await readdir(componentsRoot, { withFileTypes: true });
    for (const group of groups.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!group.isDirectory() || !/^[A-Z]/.test(group.name)) continue;
      const files = await readdir(path.join(componentsRoot, group.name)).catch(() => [] as string[]);
      if (!files.some((file) => INDEX_FILE.test(file))) continue;
      added.push({ name: group.name, path: `${kitDir}/components/${group.name}/index.tsx` });
    }
  } else {
    const entries = await readdir(path.join(root, kitDir), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !COMPONENT_EXT.test(entry.name) || COMPONENT_EXCLUDE.test(entry.name)) continue;
      const base = entry.name.replace(COMPONENT_EXT, "");
      const name = base === "index" ? "UIKit" : base;
      if (!/^[A-Z]/.test(name)) continue;
      added.push({ name, path: `${kitDir}/${entry.name}` });
    }
  }
  if (added.length === 0) return { ok: false, error: `в ${kitDir} нет компонентов кита` };

  const paths = designPackPaths(dir);
  const current = await readFile(paths.components, "utf8").then(parseManifest).catch(() => null);
  const manifest: ComponentsManifest = current ?? componentsScaffold();
  const missing = added.filter((entry) => !manifest.web.some((item) => item.path === entry.path));
  const next: ComponentsManifest = { ...manifest, web: [...manifest.web, ...missing] };
  await saveComponentsManifest(dir, next);
  return { ok: true, added: missing, kitDir, manifest: next };
}

/** Краткая сводка токенов для inline-блока AGENTS.md и системного промта провайдера. */
export function tokensSummary(tokens: ThemeTokens, mode: ThemeMode | null = null): string {
  const roles = ["accent", "page", "surface", "raised", "line", "fg", "fgMuted"] as const;
  const colors = roles.map((role) => `${roleToKebab(role)}: ${tokens.colors[role]}`).join("; ");
  const radii = `md ${tokens.rounded.md}, lg ${tokens.rounded.lg}, xl ${tokens.rounded.xl}`;
  return [`palette: ${colors}`, `radii: ${radii}`, mode ? `mode: ${mode}` : ""].filter(Boolean).join(" | ");
}
