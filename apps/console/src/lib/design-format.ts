import { parse, stringify } from "yaml";
import { COLOR_ROLES, DEFAULT_RADII, roleToKebab, type ThemeTokens } from "@/lib/themes";

/**
 * Формат DESIGN.md (@google/design.md) без обращения к файловой системе -
 * используется и на сервере (core/design.ts), и на клиенте (предпросмотр файла
 * в реальном времени при изменениях: front matter пересобирается из draft-токенов до записи).
 */

export const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const HEX_RE = /^#[0-9a-fA-F]{3}|^#[0-9a-fA-F]{6}/;
const RADIUS_RE = /^\d+(\.\d+)?(px|rem)$/;

/** Разбор front matter DESIGN.md в токены слота. */
export function parseDesign(content: string): { name: string; tokens: ThemeTokens } {
  const m = content.match(FRONT_MATTER_RE);
  const front = m ? (parse(m[1]) as Record<string, unknown>) : {};
  const colors = (front.colors ?? {}) as Record<string, string>;
  const rounded = (front.rounded ?? {}) as Record<string, string>;
  const tokens: ThemeTokens = { colors: {} as ThemeTokens["colors"], rounded: { ...DEFAULT_RADII } };
  for (const role of COLOR_ROLES) {
    const value = colors[roleToKebab(role)];
    if (typeof value === "string" && HEX_RE.test(value)) {
      tokens.colors[role] = value.trim();
    }
  }
  if (typeof rounded.md === "string" && RADIUS_RE.test(rounded.md)) tokens.rounded.md = rounded.md;
  if (typeof rounded.lg === "string" && RADIUS_RE.test(rounded.lg)) tokens.rounded.lg = rounded.lg;
  if (typeof rounded.xl === "string" && RADIUS_RE.test(rounded.xl)) tokens.rounded.xl = rounded.xl;
  return { name: typeof front.name === "string" ? front.name : "Untitled", tokens };
}

/**
 * Пересборка front matter: colors/rounded перегенерируются из токенов,
 * остальные ключи (typography, spacing, components) и markdown-тело сохраняются.
 */
export function buildDesignFile(current: string, tokens: ThemeTokens, themeName: string): string {
  const m = current.match(FRONT_MATTER_RE);
  const front = m ? (parse(m[1]) as Record<string, unknown>) : {};
  const colors: Record<string, string> = { primary: "{colors.accent}" };
  for (const role of COLOR_ROLES) colors[roleToKebab(role)] = tokens.colors[role];
  front.name = themeName;
  front.colors = colors;
  front.rounded = { md: tokens.rounded.md, lg: tokens.rounded.lg, xl: tokens.rounded.xl };
  const yaml = stringify(front, { lineWidth: 0 }).trimEnd();
  const body = m ? current.slice(m[0].length) : current;
  return `---\n${yaml}\n---\n${body}`;
}

/** Валидация токенов из запроса: все роли - hex, радиусы - dimension. */
export function validateTokens(input: unknown): ThemeTokens | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "нужен объект токенов" };
  const raw = input as { colors?: Record<string, unknown>; rounded?: Record<string, unknown>; name?: unknown };
  if (typeof raw.colors !== "object" || raw.colors === null) return { error: "нужен colors" };
  const tokens: ThemeTokens = { colors: {} as ThemeTokens["colors"], rounded: { ...DEFAULT_RADII } };
  for (const role of COLOR_ROLES) {
    const value = raw.colors[role];
    if (typeof value !== "string" || !HEX_RE.test(value)) return { error: `цвет ${role}: нужен hex` };
    tokens.colors[role] = value.trim();
  }
  for (const key of ["md", "lg", "xl"] as const) {
    const value = raw.rounded?.[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !RADIUS_RE.test(value)) return { error: `rounded.${key}: нужен px/rem` };
    tokens.rounded[key] = value;
  }
  return tokens;
}

/** Имя темы из запроса (опционально): одна строка без переносов, разумной длины. */
export function validateThemeName(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "string") return undefined;
  const name = input.replace(/\s+/g, " ").trim().slice(0, 80);
  return name.length > 0 ? name : undefined;
}
