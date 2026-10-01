"use client";

import { useEffect } from "react";
import { COLOR_ROLES, cssVarName } from "@/lib/themes";
import { finalTokens, useDesignStore } from "@/store/design";

/**
 * Клиентский слой тем: загружает токены из /api/design (DESIGN.md +
 * DESIGN.light.md) и перезаписывает <style id="design-tokens"> при каждом
 * изменении черновика - предпросмотр в реальном времени по всему приложению. Черновик
 * не персистится: обновление страницы возвращает сохранённые значения.
 */
export function DesignProvider() {
  const status = useDesignStore((s) => s.status);
  const error = useDesignStore((s) => s.error);
  const load = useDesignStore((s) => s.load);
  const darkDraft = useDesignStore((s) => s.draft.dark);
  const lightDraft = useDesignStore((s) => s.draft.light);
  const ready = useDesignStore((s) => s.status === "ready");

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  useEffect(() => {
    if (!ready) return;
    const css = buildCss(finalTokens(darkDraft), finalTokens(lightDraft));
    let style = document.getElementById("design-tokens") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "design-tokens";
      document.head.appendChild(style);
    }
    style.textContent = css;
  }, [ready, darkDraft, lightDraft]);

  if (status === "error") {
    console.warn(`DesignProvider: ${error}`);
  }
  return null;
}

function themeBlock(selector: string, tokens: ReturnType<typeof finalTokens>): string {
  const lines = COLOR_ROLES.map((role) => `  ${cssVarName(role)}: ${tokens.colors[role]};`);
  lines.push(`  --design-radius-md: ${tokens.rounded.md};`);
  lines.push(`  --design-radius-lg: ${tokens.rounded.lg};`);
  lines.push(`  --design-radius-xl: ${tokens.rounded.xl};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

function buildCss(dark: ReturnType<typeof finalTokens>, light: ReturnType<typeof finalTokens>): string {
  return `${themeBlock(':root,\n[data-theme="dark"]', dark)}\n${themeBlock('[data-theme="light"]', light)}`;
}
