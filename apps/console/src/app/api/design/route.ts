import { after } from "next/server";
import { NextResponse } from "next/server";
import { bakeGlobalsCss, designFilePaths, loadDesign, saveDesignSlot, type DesignSlotPayload } from "@/core/design";
import { validateThemeName, validateTokens } from "@/lib/design-format";
import { presetById, type ThemeMode, type ThemeTokens } from "@/lib/themes";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Текущие темы: токены + содержимое обоих DESIGN-файлов и индекс папки themes/. */
export async function GET() {
  const { repoRoot } = await serverContext();
  const fallback = {
    dark: presetById("graphite")!.tokens,
    light: presetById("graphite-light")!.tokens,
  };
  const [state, themeIndex] = await Promise.all([
    loadDesign(repoRoot, fallback),
    import("@/core/design").then((m) => m.listThemeFiles(repoRoot)),
  ]);
  return NextResponse.json({ ...state, themeIndex });
}

interface DesignPutBody {
  dark?: unknown;
  light?: unknown;
}

/**
 * Сохранение тем: валидация → lint (ошибки запрещают запись) → атомарная запись
 * DESIGN.md / DESIGN.light.md (только они; папка themes/ не меняется) →
 * bake CSS-переменных в globals.css после отправки ответа.
 * Имя слота: совпавший пресет, иначе клиентское "<База> (Custom)".
 */
export async function PUT(request: Request) {
  const { repoRoot } = await serverContext();
  const body = (await request.json().catch(() => null)) as DesignPutBody | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "нужен JSON: { dark?: slot, light?: slot }" }, { status: 400 });
  }
  const slots: Partial<Record<ThemeMode, DesignSlotPayload>> = {};
  for (const mode of ["dark", "light"] as const) {
    if (body[mode] === undefined) continue;
    const raw = body[mode];
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ error: `${mode}: нужен объект { colors, rounded, name? }` }, { status: 400 });
    }
    const tokens = validateTokens(raw);
    if ("error" in tokens) {
      return NextResponse.json({ error: `${mode}: ${tokens.error}` }, { status: 400 });
    }
    slots[mode] = { tokens, name: validateThemeName((raw as { name?: unknown }).name) };
  }
  if (!slots.dark && !slots.light) {
    return NextResponse.json({ error: "не передано ни одной темы (dark/light)" }, { status: 400 });
  }

  const warnings: string[] = [];
  const findings: unknown[] = [];
  const saved: Partial<Record<ThemeMode, { tokens: ThemeTokens; name: string }>> = {};
  for (const mode of ["dark", "light"] as const) {
    const slot = slots[mode];
    if (!slot) continue;
    const result = await saveDesignSlot(repoRoot, mode, slot.tokens, slot.name);
    if (!result.ok) {
      return NextResponse.json({ error: `${mode}: ${result.error}`, findings: result.findings }, { status: 400 });
    }
    saved[mode] = { tokens: slot.tokens, name: result.name };
    for (const finding of result.findings) {
      if (finding.severity === "warning") {
        warnings.push(`${mode === "dark" ? "DESIGN.md" : "DESIGN.light.md"} · ${finding.rule}: ${finding.message}`);
      }
      findings.push({ slot: mode, ...finding });
    }
  }

  // bake: managed-блок globals.css ← фактическое содержимое обоих файлов.
  // Выполняется после отправки ответа: в dev запись globals.css заставляет
  // Turbopack пересобрать пайплайн и оборвать ещё не отправленный ответ.
  const paths = designFilePaths(repoRoot);
  const fallback = {
    dark: saved.dark?.tokens ?? presetById("graphite")!.tokens,
    light: saved.light?.tokens ?? presetById("graphite-light")!.tokens,
  };
  const state = await loadDesign(repoRoot, fallback);
  after(async () => {
    await bakeGlobalsCss(repoRoot, state.dark.tokens, state.light.tokens);
  });

  return NextResponse.json({
    ok: true,
    saved: Object.fromEntries(Object.entries(saved).map(([mode, value]) => [mode, { name: value!.name }])),
    warnings,
    findings,
  });
}
