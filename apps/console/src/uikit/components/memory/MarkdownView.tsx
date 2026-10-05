"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import { highlightToHtml, isLanguageSupported } from "@/uikit/components/MarkdownEditor/highlight";
import { cx } from "@/uikit";

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Отделяет YAML frontmatter от тела markdown. */
export function splitFrontMatter(content: string): { body: string; frontMatter: string | null } {
  const match = content.match(FRONT_MATTER_RE);
  if (!match) return { body: content, frontMatter: null };
  return { body: content.slice(match[0].length), frontMatter: match[1] };
}

/**
 * Разрешает относительную ссылку документа в абсолютный путь файла.
 * Ссылка на каталог или путь без расширения указывает на index.md каталога.
 */
export function resolveRelativeFilePath(filePath: string, href: string): string | null {
  let target = href;
  try {
    target = decodeURIComponent(href);
  } catch {
    // некорректное процентное кодирование - строка остаётся как есть
  }
  const hashIndex = target.indexOf("#");
  if (hashIndex === 0) return null;
  if (hashIndex > 0) target = target.slice(0, hashIndex);
  if (target === "" || target.startsWith("/")) return null;
  const lastSegment = target.split("/").filter(Boolean).pop() ?? "";
  if (target.endsWith("/") || !lastSegment.includes(".")) {
    target = `${target.replace(/\/+$/, "")}/index.md`;
  }
  const segments = filePath.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  // у абсолютного filePath первый сегмент пуст и уже даёт ведущий слэш
  const resolved = segments.join("/");
  return resolved.startsWith("/") ? resolved : `/${resolved}`;
}

/** Slug заголовка для якорных ссылок (кириллица и цифры сохраняются). */
function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function textOfChildren(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOfChildren).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return textOfChildren(props?.children);
  }
  return "";
}

function makeHeading(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag id={slugifyHeading(textOfChildren(children))}>{children}</Tag>;
  };
}

/**
 * Рендер markdown (GFM: таблицы, чек-листы, зачёркивание) в тёмной теме.
 * Стилизация - arbitrary-вариантами на обёртке; mermaid-блоки показываются как код.
 * YAML frontmatter показывается сворачиваемым блоком (CommonMark без обработки
 * схлопнул бы его в одну строку).
 * `filePath` - абсолютный путь текущего документа; относительные ссылки внутри
 * документа резолвятся от него и открываются тем же просмотрщиком через
 * `onNavigate` (без перехода на несуществующий роут), внешние - в новой вкладке.
 */
export function MarkdownView({
  content,
  className,
  filePath,
  onNavigate,
}: {
  content: string;
  className?: string;
  filePath?: string;
  onNavigate?: (path: string) => void;
}) {
  const { body, frontMatter } = splitFrontMatter(content);
  const components: Components = {
    a({ node, href, children }) {
      if (!href) return <a>{children}</a>;
      if (href.startsWith("#")) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            {children}
          </a>
        );
      }
      if (/^(https?:)?\/\/|^(mailto|data):/i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      const resolved = filePath ? resolveRelativeFilePath(filePath, href) : null;
      if (!resolved || !onNavigate) {
        return (
          <a className="cursor-default" onClick={(e) => e.preventDefault()} title="Переход недоступен в этом просмотре">
            {children}
          </a>
        );
      }
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(resolved);
          }}
        >
          {children}
        </a>
      );
    },
    h1: makeHeading("h1"),
    h2: makeHeading("h2"),
    h3: makeHeading("h3"),
    h4: makeHeading("h4"),
    h5: makeHeading("h5"),
    h6: makeHeading("h6"),
    code({ className, children }) {
      const lang = /language-([\w#+-]+)/.exec(className ?? "")?.[1] ?? "";
      if (lang && isLanguageSupported(lang)) {
        return <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightToHtml(textOfChildren(children), lang) }} />;
      }
      return <code>{children}</code>;
    },
  };
  return (
    <div
      className={cx(
        "memory-md text-sm leading-relaxed text-fg-muted",
        "[&>*:first-child]:mt-0",
        "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-fg",
        "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg",
        "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-fg",
        "[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-fg",
        "[&_p]:my-3",
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
        "[&_li]:my-1 [&_li>p]:my-0",
        "[&_a]:text-info [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-info",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted",
        "[&_hr]:my-5 [&_hr]:border-line",
        "[&_strong]:text-fg",
        "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-line",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
        "[&_th]:border [&_th]:border-line [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-fg-muted",
        "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top",
        "[&_code]:rounded [&_code]:bg-raised/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-fg",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line [&_pre]:bg-page [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs",
        className,
      )}
    >
      {frontMatter ? (
        <details className="group mb-4">
          <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wide text-fg-faint hover:text-fg-muted [&::-webkit-details-marker]:hidden">
            YAML front matter
          </summary>
          <pre className="max-h-96 overflow-auto font-mono text-xs leading-relaxed text-fg-muted">
            {frontMatter}
          </pre>
        </details>
      ) : null}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
