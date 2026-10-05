// Одноразовый генератор themes/*.md из каталога пресетов (src/lib/themes.ts).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { COLOR_ROLES, PRESETS, roleToKebab, type ThemePreset } from "./src/lib/themes";

const DESCRIPTIONS: Record<string, string> = {
  graphite: "Тёмная тема консоли по умолчанию: графитовые поверхности с эмералд-акцентом",
  dracula: "Классическая тёмная палитра Dracula: сине-фиолетовый фон и неоновые акценты",
  nord: "Тёмная тема Nord: полярная ночь и морозные синие акценты",
  "one-dark": "Тёмная тема One Dark Pro: графитово-синий фон, мягкие неоновые акценты",
  "tokyo-night": "Тёмная тема Tokyo Night: глубокий индиго-фон с неоновыми акцентами ночного города",
  "graphite-light": "Светлая пара Graphite: белые панели на светло-сером фоне, тёмный графитовый текст",
  "solarized-light": "Светлая тема Solarized: тёплый кремовый фон и землистые акценты",
  "github-light": "Светлая тема GitHub: белый фон, синий primary и строгие статусные цвета",
  "nord-light": "Светлая тема Nord (Snow Storm): снежно-серые поверхности и стальной синий",
  "one-light": "Светлая тема One Light: мягкий белый фон с классическими акцентами Atom",
};

const ROLE_NOTES: Record<string, string> = {
  page: "фон страницы",
  surface: "панели и карточки",
  raised: "поля ввода и hover-состояния",
  overlay: "модалки и дропдауны",
  line: "базовые границы",
  "line-strong": "выделенные границы и активные состояния",
  fg: "основной текст",
  "fg-muted": "вторичный текст",
  "fg-faint": "приглушённый текст",
  accent: "primary-действия и позитивные статусы (алиас primary)",
  info: "ссылки и подсказки",
  warning: "предупреждения",
  danger: "деструктив и ошибки",
  "swatch-1": "категориальный: фиолетовый (монограммы рантаймов)",
  "swatch-2": "категориальный: розовый",
  "swatch-3": "категориальный: оранжевый",
  "swatch-4": "категориальный: лайм",
  "swatch-5": "категориальный: циан",
};

function components(mode: ThemePreset["mode"]) {
  const onColor = mode === "dark" ? "{colors.page}" : "{colors.surface}";
  return {
    "button-primary": { backgroundColor: "{colors.primary}", textColor: onColor, rounded: "{rounded.md}" },
    "button-ghost": { backgroundColor: "{colors.raised}", textColor: "{colors.fg}", rounded: "{rounded.md}" },
    panel: { backgroundColor: "{colors.surface}", textColor: "{colors.fg}", rounded: "{rounded.xl}" },
    "text-secondary": { backgroundColor: "{colors.surface}", textColor: "{colors.fg-muted}" },
    "text-faint": { backgroundColor: "{colors.surface}", textColor: "{colors.fg-faint}" },
    "chip-runtime-1": { backgroundColor: "{colors.surface}", textColor: "{colors.swatch-1}", rounded: "{rounded.lg}" },
    "chip-runtime-2": { backgroundColor: "{colors.surface}", textColor: "{colors.swatch-2}", rounded: "{rounded.lg}" },
    "chip-runtime-3": { backgroundColor: "{colors.surface}", textColor: "{colors.swatch-3}", rounded: "{rounded.lg}" },
    "chip-runtime-4": { backgroundColor: "{colors.surface}", textColor: "{colors.swatch-4}", rounded: "{rounded.lg}" },
    "chip-runtime-5": { backgroundColor: "{colors.surface}", textColor: "{colors.swatch-5}", rounded: "{rounded.lg}" },
  };
}

function render(preset: ThemePreset): string {
  const front = {
    version: "alpha",
    name: preset.name,
    description: DESCRIPTIONS[preset.id] ?? `Пресет темы ${preset.name}`,
    colors: Object.fromEntries([
      ["primary", "{colors.accent}"],
      ...COLOR_ROLES.map((role) => [roleToKebab(role), preset.tokens.colors[role]]),
    ]),
    rounded: { md: preset.tokens.rounded.md, lg: preset.tokens.rounded.lg, xl: preset.tokens.rounded.xl },
    spacing: { sm: "8px", md: "16px", lg: "24px" },
    typography: {
      body: { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "14px" },
      caption: { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "11px" },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
    },
    components: components(preset.mode),
  };
  const yaml = stringify(front, { lineWidth: 0 }).trimEnd();
  const colorsList = COLOR_ROLES.map((role) => {
    const kebab = roleToKebab(role);
    return `- \`${kebab}\` - \`${preset.tokens.colors[role]}\` - ${ROLE_NOTES[kebab] ?? "токен"}`;
  }).join("\n");
  const modeLabel = preset.mode === "dark" ? "Тёмная" : "Светлая";
  return `---
${yaml}
---

# ${preset.name}

## Overview

${DESCRIPTIONS[preset.id] ?? preset.name}. ${modeLabel} тема-пресет консоли Harness.

Файл-эталон: находится в \`themes/\`, читается лениво (GET /api/design/theme) и показывается
на вкладке "Настройки → Design". Выбор пресета применяет токены к слоту; при сохранении
папка \`themes/\` не меняется - обновляются только \`DESIGN.md\` и \`DESIGN.light.md\` в корне.

## Colors

${colorsList}

## Do's and Don'ts

- Токены применяются как есть; точечные изменения делаются твиками на вкладке Design
  и запекаются в \`DESIGN.md\` / \`DESIGN.light.md\` (кастом получает имя "${preset.name} (Custom)").
- Не редактируйте этот файл ради смены активной темы: активная тема всегда хранится
  в \`DESIGN.md\` / \`DESIGN.light.md\`, а \`themes/\` - только каталог пресетов.
`;
}

const outDir = path.resolve(import.meta.dir, "..", "..", "themes");
await mkdir(outDir, { recursive: true });
for (const preset of PRESETS) {
  const file = path.join(outDir, `${preset.mode}-${preset.id}.md`);
  await writeFile(file, render(preset), "utf8");
  console.log("wrote", path.basename(file));
}
