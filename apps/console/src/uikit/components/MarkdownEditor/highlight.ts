import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Подсветка синтаксиса (highlight.js) с фиксированным набором языков -
 * одного на подсвеченный редактор markdown и код-блоки предпросмотра.
 * Цвета токенов задаёт CSS-тема `.hljs-*` в globals.css на дизайн-токенах.
 */

const LANGUAGES: Record<string, unknown> = {
  markdown,
  bash,
  typescript,
  javascript,
  json,
  yaml,
  css,
  xml,
  python,
  sql,
  diff,
  dockerfile,
};

/** Частые псевдонимы fenced-блоков к каноническим именам языков. */
const ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  yml: "yaml",
  html: "xml",
  svg: "xml",
};

let registered = false;
function ensureLanguages(): void {
  if (registered) return;
  for (const [name, def] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, def as Parameters<typeof hljs.registerLanguage>[1]);
  }
  registered = true;
}

/** Каноническое имя языка fenced-блока или null, если язык не поддерживается. */
export function resolveLanguage(lang: string): string | null {
  const name = (ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()).trim();
  return name in LANGUAGES ? name : null;
}

export function isLanguageSupported(lang: string): boolean {
  return resolveLanguage(lang) !== null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * HTML с подсветкой; неизвестный язык возвращается экранированным текстом
 * (подсветка не должна ломать рендер блока).
 */
export function highlightToHtml(code: string, lang: string): string {
  const name = resolveLanguage(lang);
  if (!name) return escapeHtml(code);
  ensureLanguages();
  try {
    return hljs.highlight(code, { language: name }).value;
  } catch {
    return escapeHtml(code);
  }
}
