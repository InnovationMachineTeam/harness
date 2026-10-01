import { COLOR_ROLES, type ColorRole, type ThemeTokens, normalizeHex } from "@/lib/themes";

/**
 * Цветовые трансформы для твиков темы: hex ↔ HSL и множители.
 * Слайдеры панели Design хранят множители относительно базовых значений,
 * финальные токены считаются из базы трансформами (детерминированно и обратимо).
 */

export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lig = Math.min(100, Math.max(0, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to255 = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to255(f(0))}${to255(f(8))}${to255(f(4))}`;
}

const SURFACE_ROLES: ColorRole[] = ["page", "surface", "raised", "overlay", "line", "lineStrong"];
const TEXT_ROLES: ColorRole[] = ["fg", "fgMuted", "fgFaint"];
const ACCENT_ROLES: ColorRole[] = ["accent", "info", "warning", "danger", "swatch1", "swatch2", "swatch3", "swatch4", "swatch5"];

export type Multipliers = {
  /** Насыщенность всех цветов, 0-2. */
  saturation: number;
  /** Светлота поверхностей и границ, 0.8-1.3. */
  surfaceLight: number;
  /** Разброс светлоты текста от среднего, 0.7-1.3. */
  textContrast: number;
  /** Светлота акцентов, 0.8-1.3. */
  accentLight: number;
  /** Радиусы, 0-2. */
  roundness: number;
};

export const IDENTITY: Multipliers = { saturation: 1, surfaceLight: 1, textContrast: 1, accentLight: 1, roundness: 1 };

export function isIdentity(m: Multipliers): boolean {
  return (Object.keys(IDENTITY) as (keyof Multipliers)[]).every((k) => m[k] === IDENTITY[k]);
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Финальные токены = база × множители. Hex-значения перекрашиваются через HSL. */
export function applyMultipliers(base: ThemeTokens, m: Multipliers): ThemeTokens {
  const colors = {} as ThemeTokens["colors"];
  const hslCache = new Map<ColorRole, Hsl>();
  for (const role of COLOR_ROLES) {
    const hsl = hexToHsl(base.colors[role]) ?? { h: 0, s: 0, l: 50 };
    hslCache.set(role, hsl);
    const s = clamp(hsl.s * m.saturation, 0, 100);
    colors[role] = hslToHex({ h: hsl.h, s, l: hsl.l });
  }
  const paint = (roles: ColorRole[], fn: (hsl: Hsl) => Hsl) => {
    for (const role of roles) {
      const hsl = hexToHsl(colors[role]);
      if (hsl) colors[role] = hslToHex(fn(hsl));
    }
  };
  paint(SURFACE_ROLES, (hsl) => ({ ...hsl, l: clamp(hsl.l * m.surfaceLight, 0, 100) }));
  const avgL = TEXT_ROLES.reduce((sum, role) => sum + (hexToHsl(colors[role])?.l ?? 50), 0) / TEXT_ROLES.length;
  paint(TEXT_ROLES, (hsl) => ({ ...hsl, l: clamp(avgL + (hsl.l - avgL) * m.textContrast, 0, 100) }));
  paint(ACCENT_ROLES, (hsl) => ({ ...hsl, l: clamp(hsl.l * m.accentLight, 4, 96) }));
  const rounded = {
    md: scaleRadius(base.rounded.md, m.roundness),
    lg: scaleRadius(base.rounded.lg, m.roundness),
    xl: scaleRadius(base.rounded.xl, m.roundness),
  };
  return { colors, rounded };
}

function scaleRadius(value: string, mult: number): string {
  const px = parseFloat(value);
  if (Number.isNaN(px)) return value;
  return `${clamp(Math.round(px * mult * 10) / 10, 0, 32)}px`;
}

/** Радиус в число px (для слайдера "скруглённость"). */
export function radiusToPx(value: string): number {
  const px = parseFloat(value);
  return Number.isNaN(px) ? 0 : px;
}
