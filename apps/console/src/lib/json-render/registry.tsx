"use client";

import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";

/**
 * Реестр React-компонентов каталога json-render (lib/json-render/catalog.ts):
 * спецификация компонентов на дизайн-токенах консоли. Используется
 * <Renderer registry={registry}> в components/agent.
 */
export const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <div className="rounded-xl border border-line bg-surface/60 p-4">
        {props.title ? <h3 className="text-sm font-semibold text-fg">{props.title}</h3> : null}
        {props.description ? <p className="mt-0.5 text-xs text-fg-muted">{props.description}</p> : null}
        {children ? <div className="mt-2 space-y-2">{children}</div> : null}
      </div>
    ),
    Heading: ({ props }) => {
      const level = props.level ?? "h3";
      const sizes = { h2: "text-base", h3: "text-sm", h4: "text-xs" } as const;
      const Tag = level;
      return <Tag className={`${sizes[level]} font-semibold text-fg`}>{props.text}</Tag>;
    },
    Text: ({ props }) => <p className="text-xs leading-relaxed text-fg-muted">{props.content}</p>,
    List: ({ props }) => {
      const items = props.items ?? [];
      if (props.ordered) {
        return (
          <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-fg-muted">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-fg-muted">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    },
    Table: ({ props }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {(props.columns ?? []).map((col, i) => (
                <th key={i} className="border-b border-line px-2 py-1.5 text-left font-semibold text-fg">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(props.rows ?? []).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="border-b border-line/60 px-2 py-1.5 text-fg-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    Metric: ({ props }) => (
      <div className="rounded-lg border border-line bg-page/60 px-3 py-2">
        <p className="text-[11px] text-fg-faint">{props.label}</p>
        <p className="text-lg font-semibold text-fg">{props.value}</p>
        {props.hint ? <p className="text-[11px] text-fg-faint">{props.hint}</p> : null}
      </div>
    ),
  },
});
