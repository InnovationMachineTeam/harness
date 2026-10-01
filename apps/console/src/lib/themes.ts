/**
 * Каталог тем консоли: 5 тёмных + 5 светлых пресетов.
 * Токены (18 цветов + 3 радиуса) - единый формат для пресетов, DESIGN.md-файлов
 * и CSS-переменных (--design-<role-kebab>). Канонические файлы: DESIGN.md (тёмная)
 * и DESIGN.light.md (светлая) в корне репозитория; пресеты - встроенные значения,
 * которые можно назначить слоту на вкладке "Настройки → Design" и запечь в файлы.
 */

export type ThemeMode = "dark" | "light";

export const COLOR_ROLES = [
  "page",
  "surface",
  "raised",
  "overlay",
  "line",
  "lineStrong",
  "fg",
  "fgMuted",
  "fgFaint",
  "accent",
  "info",
  "warning",
  "danger",
  "swatch1",
  "swatch2",
  "swatch3",
  "swatch4",
  "swatch5",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];
export type ThemeColors = Record<ColorRole, string>;
export type ThemeRadii = { md: string; lg: string; xl: string };
export type ThemeTokens = { colors: ThemeColors; rounded: ThemeRadii };

export interface ThemePreset {
  id: string;
  name: string;
  mode: ThemeMode;
  tokens: ThemeTokens;
}

/** Русские подписи ролей для панели твиков. */
export const ROLE_LABELS: Record<ColorRole, string> = {
  page: "Фон страницы",
  surface: "Панель",
  raised: "Приподнятая панель",
  overlay: "Модалка",
  line: "Граница",
  lineStrong: "Граница сильная",
  fg: "Текст основной",
  fgMuted: "Текст вторичный",
  fgFaint: "Текст приглушённый",
  accent: "Акцент (primary)",
  info: "Инфо",
  warning: "Предупреждение",
  danger: "Опасно",
  swatch1: "Палитра 1 (фиолет)",
  swatch2: "Палитра 2 (розовый)",
  swatch3: "Палитра 3 (оранж)",
  swatch4: "Палитра 4 (лайм)",
  swatch5: "Палитра 5 (циан)",
};

/** Порядок секций в панели твиков и в DESIGN.md. */
export const ROLE_GROUPS: { title: string; roles: ColorRole[] }[] = [
  { title: "Поверхности", roles: ["page", "surface", "raised", "overlay"] },
  { title: "Границы", roles: ["line", "lineStrong"] },
  { title: "Текст", roles: ["fg", "fgMuted", "fgFaint"] },
  { title: "Смысловые акценты", roles: ["accent", "info", "warning", "danger"] },
  { title: "Категориальная палитра (монограммы рантаймов)", roles: ["swatch1", "swatch2", "swatch3", "swatch4", "swatch5"] },
];

export const DEFAULT_RADII: ThemeRadii = { md: "6px", lg: "8px", xl: "12px" };

/** Роль → kebab-case (хвост CSS-переменной и ключ в YAML front matter). */
const ROLE_KEBAB: Record<ColorRole, string> = {
  page: "page",
  surface: "surface",
  raised: "raised",
  overlay: "overlay",
  line: "line",
  lineStrong: "line-strong",
  fg: "fg",
  fgMuted: "fg-muted",
  fgFaint: "fg-faint",
  accent: "accent",
  info: "info",
  warning: "warning",
  danger: "danger",
  swatch1: "swatch-1",
  swatch2: "swatch-2",
  swatch3: "swatch-3",
  swatch4: "swatch-4",
  swatch5: "swatch-5",
};

/** kebab-case → роль. */
const KEBAB_ROLE: Record<string, ColorRole> = Object.fromEntries(
  (Object.entries(ROLE_KEBAB) as [ColorRole, string][]).map(([role, kebab]) => [kebab, role]),
) as Record<string, ColorRole>;

export function roleToKebab(role: ColorRole): string {
  return ROLE_KEBAB[role];
}

export function kebabToRole(kebab: string): ColorRole | null {
  return KEBAB_ROLE[kebab] ?? null;
}

export function cssVarName(role: ColorRole): string {
  return `--design-${ROLE_KEBAB[role]}`;
}

/** Нормализация hex: lowercase, #abc → #aabbcc; возвращает null для не-hex. */
const SHORT_HEX = /^#[0-9a-f]{3}$/;
const LONG_HEX = /^#[0-9a-f]{6}$/;

export function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (LONG_HEX.test(v)) return v;
  if (SHORT_HEX.test(v)) {
    const body = v.slice(1);
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return null;
}

/** Совпадает ли набор токенов с пресетом (hex сравниваются нормализованно). */
export function matchPreset(mode: ThemeMode, tokens: ThemeTokens): ThemePreset | null {
  return (
    PRESETS.find((p) => {
      if (p.mode !== mode) return false;
      if (JSON.stringify(p.tokens.rounded) !== JSON.stringify(tokens.rounded)) return false;
      return COLOR_ROLES.every((role) => {
        const a = normalizeHex(p.tokens.colors[role]);
        const b = normalizeHex(tokens.colors[role]);
        return a !== null && a === b;
      });
    }) ?? null
  );
}

const radii = (): ThemeRadii => ({ ...DEFAULT_RADII });

function tokens(colors: ThemeColors): ThemeTokens {
  return { colors, rounded: radii() };
}

function c(map: Record<ColorRole, string>): ThemeColors {
  return map as ThemeColors;
}

export const PRESETS: ThemePreset[] = [
  {
    id: "graphite",
    name: "Graphite",
    mode: "dark",
    tokens: tokens(
      c({
        page: "#242528",
        surface: "#2a2c30",
        raised: "#333539",
        overlay: "#383a3e",
        line: "#43464a",
        lineStrong: "#55585d",
        fg: "#ececee",
        fgMuted: "#a9abae",
        fgFaint: "#94969b",
        accent: "#34d399",
        info: "#38bdf8",
        warning: "#fbbf24",
        danger: "#f87171",
        swatch1: "#a78bfa",
        swatch2: "#fb7185",
        swatch3: "#fb923c",
        swatch4: "#a3e635",
        swatch5: "#22d3ee",
      }),
    ),
  },
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    tokens: tokens(
      c({
        page: "#282a36",
        surface: "#2d2f3d",
        raised: "#353846",
        overlay: "#3b3e4e",
        line: "#44475a",
        lineStrong: "#565869",
        fg: "#f8f8f2",
        fgMuted: "#a9adcd",
        fgFaint: "#6272a4",
        accent: "#50fa7b",
        info: "#8be9fd",
        warning: "#f1fa8c",
        danger: "#ff5555",
        swatch1: "#bd93f9",
        swatch2: "#ff79c6",
        swatch3: "#ffb86c",
        swatch4: "#f1fa8c",
        swatch5: "#57c7ff",
      }),
    ),
  },
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    tokens: tokens(
      c({
        page: "#2e3440",
        surface: "#3b4252",
        raised: "#434c5e",
        overlay: "#4c566a",
        line: "#4c566a",
        lineStrong: "#5e6a86",
        fg: "#eceff4",
        fgMuted: "#c0c8d8",
        fgFaint: "#8891a5",
        accent: "#88c0d0",
        info: "#81a1c1",
        warning: "#ebcb8b",
        danger: "#bf616a",
        swatch1: "#b48ead",
        swatch2: "#d08770",
        swatch3: "#a3be8c",
        swatch4: "#8fbcbb",
        swatch5: "#88c0d0",
      }),
    ),
  },
  {
    id: "one-dark",
    name: "One Dark Pro",
    mode: "dark",
    tokens: tokens(
      c({
        page: "#282c34",
        surface: "#2c313a",
        raised: "#353b45",
        overlay: "#3b4048",
        line: "#3e4451",
        lineStrong: "#4d5566",
        fg: "#d7dae0",
        fgMuted: "#abb2bf",
        fgFaint: "#7f8798",
        accent: "#61afef",
        info: "#56b6c2",
        warning: "#e5c07b",
        danger: "#e06c75",
        swatch1: "#c678dd",
        swatch2: "#e06c75",
        swatch3: "#d19a66",
        swatch4: "#98c379",
        swatch5: "#56b6c2",
      }),
    ),
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    tokens: tokens(
      c({
        page: "#1a1b26",
        surface: "#212330",
        raised: "#292e42",
        overlay: "#2f3450",
        line: "#292e42",
        lineStrong: "#3b4261",
        fg: "#c0caf5",
        fgMuted: "#a9b1d6",
        fgFaint: "#6b7394",
        accent: "#7aa2f7",
        info: "#7dcfff",
        warning: "#e0af68",
        danger: "#f7768e",
        swatch1: "#bb9af7",
        swatch2: "#f7768e",
        swatch3: "#ff9e64",
        swatch4: "#9ece6a",
        swatch5: "#73daca",
      }),
    ),
  },
  {
    id: "graphite-light",
    name: "Graphite Light",
    mode: "light",
    tokens: tokens(
      c({
        page: "#f4f4f5",
        surface: "#ffffff",
        raised: "#ebebed",
        overlay: "#ffffff",
        line: "#dddee1",
        lineStrong: "#c4c6ca",
        fg: "#1d1e20",
        fgMuted: "#55575c",
        fgFaint: "#72747c",
        accent: "#047857",
        info: "#0369a1",
        warning: "#b45309",
        danger: "#dc2626",
        swatch1: "#7c3aed",
        swatch2: "#e11d48",
        swatch3: "#c2410c",
        swatch4: "#4d7c0f",
        swatch5: "#0e7490",
      }),
    ),
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    tokens: tokens(
      c({
        page: "#fdf6e3",
        surface: "#fefaf1",
        raised: "#eee8d5",
        overlay: "#f4eeda",
        line: "#ddd6c1",
        lineStrong: "#c8c0a8",
        fg: "#073642",
        fgMuted: "#586e75",
        fgFaint: "#93a1a1",
        accent: "#268bd2",
        info: "#2aa198",
        warning: "#b58900",
        danger: "#dc322f",
        swatch1: "#6c71c4",
        swatch2: "#d33682",
        swatch3: "#cb4b16",
        swatch4: "#859900",
        swatch5: "#2aa198",
      }),
    ),
  },
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    tokens: tokens(
      c({
        page: "#ffffff",
        surface: "#f6f8fa",
        raised: "#eff2f5",
        overlay: "#ffffff",
        line: "#d1d9e0",
        lineStrong: "#afb8c1",
        fg: "#1f2328",
        fgMuted: "#59636e",
        fgFaint: "#818b98",
        accent: "#0969da",
        info: "#1b7c83",
        warning: "#9a6700",
        danger: "#cf222e",
        swatch1: "#8250df",
        swatch2: "#bf3989",
        swatch3: "#bc4c00",
        swatch4: "#1a7f37",
        swatch5: "#1b7c83",
      }),
    ),
  },
  {
    id: "nord-light",
    name: "Nord Light",
    mode: "light",
    tokens: tokens(
      c({
        page: "#eceff4",
        surface: "#fafbfd",
        raised: "#e3e8f0",
        overlay: "#eef2f7",
        line: "#d8dee9",
        lineStrong: "#b9c3d1",
        fg: "#2e3440",
        fgMuted: "#434c5e",
        fgFaint: "#7b8694",
        accent: "#5e81ac",
        info: "#5c8cb8",
        warning: "#b58900",
        danger: "#b5505a",
        swatch1: "#8f6d92",
        swatch2: "#b5654a",
        swatch3: "#739e57",
        swatch4: "#5ba3a0",
        swatch5: "#6a93c4",
      }),
    ),
  },
  {
    id: "one-light",
    name: "One Light",
    mode: "light",
    tokens: tokens(
      c({
        page: "#fafafa",
        surface: "#ffffff",
        raised: "#f0f0f1",
        overlay: "#f6f6f6",
        line: "#dcdfe4",
        lineStrong: "#c5cad1",
        fg: "#383a42",
        fgMuted: "#5c6370",
        fgFaint: "#9d9fa8",
        accent: "#4078f2",
        info: "#0184bc",
        warning: "#c18401",
        danger: "#e45649",
        swatch1: "#a626a4",
        swatch2: "#ca1243",
        swatch3: "#b76b01",
        swatch4: "#50a14f",
        swatch5: "#0184bc",
      }),
    ),
  },
];

export function presetsFor(mode: ThemeMode): ThemePreset[] {
  return PRESETS.filter((p) => p.mode === mode);
}

/** Имя файла пресета в папке themes/ корня репозитория. */
export function themePresetFile(preset: ThemePreset): string {
  return `${preset.mode}-${preset.id}.md`;
}

export function presetById(id: string): ThemePreset | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}
