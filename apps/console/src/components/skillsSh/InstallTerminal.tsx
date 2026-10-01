"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Терминал установки: читает SSE-стрим вывода job'а (skills.sh или инструментов)
 * и позволяет писать в stdin процесса (интерактивные вопросы CLI, если возникнут).
 */
export function InstallTerminal({
  jobId,
  onDone,
  streamUrl = `/api/skills-sh/install?jobId=${encodeURIComponent(jobId)}`,
  inputUrl = "/api/skills-sh/install/input",
}: {
  jobId: string;
  onDone?: (exitCode: number | null) => void;
  /** URL SSE-стрима (по умолчанию - skills.sh). */
  streamUrl?: string;
  /** URL отправки stdin (по умолчанию - skills.sh). */
  inputUrl?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let closed = false;

    void (async () => {
      try {
        const res = await fetch(streamUrl, {
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          setLines((prev) => [...prev, `── стрим недоступен (HTTP ${res.status}) - job не найден или сервер перезапустился ──`]);
          setDone(true);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone || closed) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const event = JSON.parse(dataLine.slice(6)) as { line?: string; done?: boolean; exitCode?: number | null };
              if (typeof event.line === "string" && event.line !== "") {
                setLines((prev) => [...prev, event.line as string].slice(-300));
              }
              if (event.done) {
                setDone(true);
                setExitCode(event.exitCode ?? null);
                onDone?.(event.exitCode ?? null);
                return;
              }
            } catch {
              /* пропуск повреждённого кадра */
            }
          }
        }
      } catch {
        /* стрим оборван - оставляем накопленное */
      }
    })();

    return () => {
      closed = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, streamUrl]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [lines]);

  const send = async () => {
    if (!input.trim() || done) return;
    await fetch(inputUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, text: input.trim() }),
    });
    setInput("");
  };

  return (
    <div className="rounded-xl border border-line bg-page">
      <div
        ref={boxRef}
        className="max-h-72 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-muted"
      >
        {lines.length === 0 ? <p className="text-fg-faint">ожидание вывода…</p> : null}
        {lines.map((line, i) => (
          <p key={i} className={`whitespace-pre-wrap ${line.startsWith("›") ? "text-info" : line.startsWith("──") ? "text-fg-faint" : ""}`}>
            {line}
          </p>
        ))}
        {done ? (
          <p className={exitCode === 0 ? "text-accent" : "text-danger"}>
            ── стрим завершен{exitCode !== null ? ` (exit ${exitCode})` : ""} ──
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="font-mono text-xs text-fg-faint">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          disabled={done}
          placeholder={done ? "процесс завершён" : "ввод для stdin (Enter - отправить)"}
          className="flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-faint focus:outline-none"
        />
      </div>
    </div>
  );
}
