"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SessionDetail, SessionSummary } from "@/core/types";
import { relativeTime } from "@/lib/format";
import { useConsoleStore } from "@/store/console";
import { confirmDialog, Button, EmptyState, FieldLabel, IconButton, Loading, Select, Textarea } from "@/ui/UIKit";

interface WorkspaceEntry {
  mandatory: { path: string; exists: boolean };
  additional: { path: string; exists: boolean }[];
}

interface ReplyResult {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  output: string;
  stderr?: string;
  note: string;
}

export function SessionPanel({ runtime }: { runtime: string }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry | null>(null);
  const [dir, setDir] = useState<string>("");
  const [sessions, setSessions] = useState<{ supported: boolean; sessions: SessionSummary[] } | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyResult, setReplyResult] = useState<ReplyResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/workspaces", { cache: "no-store" })
      .then((r) => r.json())
      .then((w: WorkspaceEntry) => {
        setWorkspaces(w);
        if (!dir) setDir(w.mandatory.path);
      })
      .catch(() => setWorkspaces(null));
  }, [dir]);

  const fetchTabData = useConsoleStore((s) => s.fetchTabData);

  // список сессий кешируется в store (ключ включает папку) - переключение
  // вкладок и возврат на страницу мгновенны
  const loadSessions = useCallback(
    async (ttlMs = 10_000) => {
      const query = new URLSearchParams({ runtime, ...(dir ? { dir } : {}) });
      const data = await fetchTabData<{ supported: boolean; sessions: SessionSummary[] }>(
        `sessions:${runtime}:${dir}`,
        `/api/sessions?${query}`,
        ttlMs,
      );
      if (data) {
        setSessions({ supported: Boolean(data.supported), sessions: data.sessions ?? [] });
        setDetail(null);
      }
    },
    [fetchTabData, runtime, dir],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const openSession = async (id: string) => {
    setReplyResult(null);
    setReplyText("");
    const res = await fetch(`/api/sessions?runtime=${runtime}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) {
      setDetail(null);
      return;
    }
    const data = await res.json();
    setDetail(data.detail ?? null);
  };

  const sendReply = async (session: SessionSummary) => {
    if (!replyText.trim()) return;
    if (
      !(await confirmDialog({
        title: "Отправить ответ в сессию?",
        message: `Сессия ${session.id.slice(0, 24)}…\nОтвет выполнится headless-процессом (сессия продолжится отдельным запуском CLI).`,
        confirmLabel: "Отправить",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/sessions/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtime,
          sessionId: session.id,
          text: replyText.trim(),
          cwd: session.workspaceDir,
        }),
      });
      setReplyResult(await res.json());
    } finally {
      setBusy(false);
    }
  };

  if (sessions && !sessions.supported) {
    return (
      <EmptyState>
        История сессий этого рантайма хранится в SQLite-хранилище - чтение списков и ответы из консоли не
        поддерживаются.
      </EmptyState>
    );
  }

  const dirOptions = workspaces
    ? [...[workspaces.mandatory, ...workspaces.additional].filter((d) => d.exists).map((d) => ({ value: d.path, label: d.path })), { value: "", label: "все папки" }]
    : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <section className="lg:col-span-2">
        <div className="mb-3 flex items-center gap-2">
          <FieldLabel htmlFor="session-dir">папка:</FieldLabel>
          <Select
            id="session-dir"
            value={dir}
            onChange={setDir}
            options={dirOptions}
            className="max-w-full min-w-0 flex-1"
            ariaLabel="рабочая папка сессий"
          />
          <IconButton
            icon={RefreshCw}
            label="Обновить список"
            onClick={() => void loadSessions()}
          />
        </div>

        {sessions === null ? (
          <Loading />
        ) : sessions.sessions.length === 0 ? (
          <EmptyState size="sm">Сессий для этой папки не найдено.</EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {sessions.sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void openSession(s.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    detail?.summary.id === s.id
                      ? "border-line-strong bg-raised/60"
                      : "border-line bg-surface/40 hover:border-line-strong"
                  }`}
                >
                  <p className="truncate text-xs font-medium text-fg">
                    {s.titleHint ?? s.id}
                  </p>
                  <p className="mt-0.5 text-[10px] text-fg-faint">
                    {relativeTime(s.lastActivityAt, Date.now())}
                    {s.workspaceDir ? ` · ${s.workspaceDir.split("/").pop()}` : ""}
                    {s.resumable ? " · resumable" : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lg:col-span-3">
        {!detail ? (
          <EmptyState>Выберите сессию слева - здесь появятся метаданные и превью диалога.</EmptyState>
        ) : (
          <article className="rounded-xl border border-line bg-surface/60 p-4">
            <header className="mb-3 border-b border-line/60 pb-3">
              <h3 className="text-sm font-semibold text-fg">
                {detail.summary.titleHint ?? detail.summary.id}
              </h3>
              <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-fg-faint">
                <span className="font-mono">{detail.summary.id}</span>
                {detail.summary.startedAt ? <span>начало: {relativeTime(detail.summary.startedAt, Date.now())}</span> : null}
                <span>активность: {relativeTime(detail.summary.lastActivityAt, Date.now())}</span>
                {detail.summary.workspaceDir ? <span>папка: {detail.summary.workspaceDir}</span> : null}
              </p>
              <p className="mt-1 font-mono text-[10px] text-fg-faint">{detail.file}</p>
            </header>

            {detail.excerpt.length === 0 ? (
              <p className="text-xs text-fg-faint">
                Транскрипт недоступен для этого формата лога - полные данные в файле сессии.
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {detail.excerpt.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-lg px-3 py-2 text-xs ${
                      m.role === "user" ? "bg-raised/60 text-fg" : "bg-page/60 text-fg-muted"
                    }`}
                  >
                    <span className="mr-2 font-mono text-[10px] text-fg-faint">{m.role}</span>
                    {m.text}
                  </div>
                ))}
              </div>
            )}

            {detail.summary.resumable ? (
              <footer className="mt-4 border-t border-line/60 pt-3">
                <p className="mb-2 text-[11px] text-fg-faint">
                  Ответить в сессию - headless-resume CLI (продолжение отдельным процессом):
                </p>
                <div className="flex gap-2">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={2}
                    placeholder="ответ / уточнение для сессии…"
                    size="form"
                    className="flex-1"
                  />
                  <Button
                    variant="accent"
                    size="md"
                    disabled={busy || !replyText.trim()}
                    onClick={() => void sendReply(detail.summary)}
                    className="self-end"
                  >
                    {busy ? "…" : "Отправить"}
                  </Button>
                </div>
                {replyResult ? (
                  <div className="mt-3 rounded-lg border border-line bg-page/60 p-3">
                    <p className={`text-xs ${replyResult.ok ? "text-accent" : "text-danger"}`}>
                      {replyResult.ok ? "Готово" : "Ошибка"} · {Math.round(replyResult.durationMs / 1000)} с
                      {replyResult.exitCode !== null ? ` · exit ${replyResult.exitCode}` : ""}
                    </p>
                    {replyResult.stderr ? (
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-danger">
                        {replyResult.stderr}
                      </pre>
                    ) : null}
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] text-fg-muted">
                      {replyResult.output || "(пустой вывод)"}
                    </pre>
                    <p className="mt-1 text-[10px] text-fg-faint">{replyResult.note}</p>
                  </div>
                ) : null}
              </footer>
            ) : null}
          </article>
        )}
      </section>
    </div>
  );
}
