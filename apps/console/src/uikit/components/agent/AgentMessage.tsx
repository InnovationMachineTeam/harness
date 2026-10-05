"use client";

import { Renderer, StateProvider, VisibilityProvider, useJsonRenderMessage, type DataPart } from "@json-render/react";
import type { UIMessage } from "ai";
import { MarkdownView } from "@/uikit/components/memory/MarkdownView";
import { registry } from "@/lib/json-render/registry";

/**
 * Сообщение диалога вкладки "Агент". Ответ ассистента: текст (markdown) и
 * UI-спека json-render из data-spec частей стрима (useJsonRenderMessage);
 * вопрос пользователя - пузырь справа. time - время реплики (HH:MM) под
 * содержимым; у ассистента заполняется после завершения ответа.
 */
/** Метка состояния tool-части стрима для строки инструмента. */
function toolStateLabel(state: string | undefined): string {
  if (state === "input-streaming") return "выполняется";
  if (state === "input-available") return "вызов принят";
  if (state === "output-error") return "ошибка";
  if (state === "output-available") return "выполнено";
  return "выполняется";
}

export function AgentMessage({ message, time }: { message: UIMessage; time?: string | null }) {
  const { spec, text, hasSpec } = useJsonRenderMessage(message.parts as DataPart[]);
  const toolParts = message.role === "assistant"
    ? message.parts.filter((part) => part.type.startsWith("tool-") || part.type.startsWith("dynamic-tool-"))
    : [];

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-raised/60 px-4 py-2.5 text-sm text-fg">
          {text}
        </div>
        {time ? <span className="mt-0.5 mr-1 text-[10px] text-fg-faint">{time}</span> : null}
      </div>
    );
  }

  return (
    <div className="max-w-[94%] space-y-3">
      {text ? <MarkdownView content={text} className="text-sm" /> : null}
      {toolParts.map((part, index) => {
        const record = part as { type: string; state?: string; errorText?: string };
        const name = record.type.replace(/^dynamic-tool-/, "").replace(/^tool-/, "");
        return (
          <p key={index} className="rounded-lg border border-line bg-raised/40 px-3 py-1.5 font-mono text-[11px] text-fg-faint">
            инструмент {name}: {toolStateLabel(record.state)}{record.errorText ? ` - ${record.errorText}` : ""}
          </p>
        );
      })}
      {hasSpec && spec ? (
        <StateProvider initialState={{}}>
          <VisibilityProvider>
            <Renderer spec={spec} registry={registry} />
          </VisibilityProvider>
        </StateProvider>
      ) : null}
      {time ? <span className="block text-[10px] text-fg-faint">{time}</span> : null}
    </div>
  );
}
