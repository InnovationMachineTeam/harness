"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import type { DirectChatMeta } from "@/core/directChats";
import type { SessionSummary } from "@/core/types";
import type { RunStatus, WorkflowRunRecord } from "@/core/workflows/storage";
import { durationLabel, relativeTime } from "@/lib/format";
import { sessionMetricsParts } from "@/uikit/components/SessionMetricsLine";
import { Chip, EmptyState, IconButton, Loading, Modal } from "@/uikit";
import { VirtualList } from "@/uikit/components/VirtualList";

/**
 * История вкладки "Агент". Режим Direct - Direct-чаты (.agents/console/direct)
 * плюс сессии рантаймов рабочей папки; режим workflow - запуски рабочей папки.
 * Когда открыт диалог, блок свёрнут в заголовок; клик по заголовку или блоку
 * открывает модальное окно с виртуализированным списком. Строки кликабельны:
 * чат - открыть в диалоге, сессия рантайма - превью транскрипта, запуск -
 * страница run.
 */

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "в очереди",
  running: "выполняется",
  waiting: "ожидает",
  completed: "завершён",
  failed: "ошибка",
  cancelled: "отменён",
  interrupted: "прерван",
};

const RUN_STATUS_TONE: Record<RunStatus, "dim" | "sky" | "emerald" | "red" | "amber"> = {
  queued: "dim",
  running: "sky",
  waiting: "dim",
  completed: "emerald",
  failed: "red",
  cancelled: "amber",
  interrupted: "red",
};

const ROW_HEIGHT = 48;
const LIST_HEIGHT = 224;
const MODAL_LIST_HEIGHT = 480;

type DirectItem =
  | { kind: "chat"; chat: DirectChatMeta }
  | { kind: "session"; session: SessionSummary };

function dirName(dir: string | undefined): string {
  return dir ? dir.split("/").filter(Boolean).at(-1)! : "";
}

/** Метрики сессии из индекса одним суффиксом строки; без метрик - пусто. */
function sessionMetricsSuffix(session: SessionSummary): string {
  if (!session.metrics) return "";
  const parts = sessionMetricsParts(session.metrics).filter((part) => !part.startsWith("инструменты"));
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

function DirectRow({ item, onOpen }: { item: DirectItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col justify-center border-b border-line/40 px-1 text-left transition-colors hover:bg-raised/40"
    >
      {item.kind === "chat" ? (
        <>
          <p className="truncate text-xs text-fg">{item.chat.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-fg-faint">
            direct-чат · {item.chat.messageCount} сообщений · {relativeTime(item.chat.updatedAt, Date.now())}
          </p>
        </>
      ) : (
        <>
          <p className="truncate text-xs text-fg">{item.session.titleHint ?? item.session.id}</p>
          <p className="mt-0.5 truncate text-[10px] text-fg-faint">
            {item.session.runtime}
            {item.session.workspaceDir ? ` · ${dirName(item.session.workspaceDir)}` : ""}
            {` · ${relativeTime(item.session.lastActivityAt, Date.now())}`}
            {item.session.resumable ? " · resumable" : ""}
            {sessionMetricsSuffix(item.session)}
          </p>
        </>
      )}
    </button>
  );
}

function RunRow({ run, onOpen }: { run: WorkflowRunRecord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full w-full flex-col justify-center border-b border-line/40 px-1 text-left transition-colors hover:bg-raised/40"
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-xs text-fg">{run.title}</p>
        <Chip tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Chip>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-fg-faint">
        {run.workflowId}
        {` · ${relativeTime(run.createdAt, Date.now())}`}
        {runDuration(run) ? ` · ${runDuration(run)}` : ""}
      </p>
    </button>
  );
}

function runDuration(run: WorkflowRunRecord): string | null {
  if (!run.startedAt) return null;
  const end = run.finishedAt ?? (run.status === "running" ? Date.now() : null);
  if (!end) return null;
  return durationLabel(new Date(end).getTime() - new Date(run.startedAt).getTime());
}

export function AgentActivityList({
  mode,
  cwd,
  refreshToken,
  collapsed,
  onOpenChat,
  onOpenSession,
  onOpenRun,
}: {
  mode: "direct" | "workflow";
  cwd: string;
  refreshToken?: number;
  /** Диалог открыт - блок свёрнут в заголовок-кнопку. */
  collapsed: boolean;
  onOpenChat: (chat: DirectChatMeta) => void;
  onOpenSession: (session: SessionSummary) => void;
  onOpenRun: (runId: string) => void;
}) {
  const [chats, setChats] = useState<DirectChatMeta[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [runs, setRuns] = useState<WorkflowRunRecord[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback((dir: string) => {
    if (mode === "direct") {
      setChats(null);
      setSessions(null);
      const query = new URLSearchParams();
      if (dir) query.set("dir", dir);
      void fetch("/api/direct-chats", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { chats?: DirectChatMeta[] }) => setChats(j.chats ?? []))
        .catch(() => setChats([]));
      void fetch(`/api/sessions?${query}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { supported?: boolean; sessions?: SessionSummary[] }) => {
          setSupported(j.supported !== false);
          setSessions(j.sessions ?? []);
        })
        .catch(() => setSessions([]));
      return;
    }
    setRuns(null);
    const query = new URLSearchParams();
    if (dir) query.set("workspace", dir);
    void fetch(`/api/workflow-runs?${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { runs?: WorkflowRunRecord[] }) => setRuns(j.runs ?? []))
      .catch(() => setRuns([]));
  }, [mode]);

  useEffect(() => {
    load(cwd);
  }, [load, cwd, refreshToken]);

  const directItems: DirectItem[] | null =
    mode === "direct" && chats !== null && sessions !== null
      ? [
          ...chats.map((chat): DirectItem => ({ kind: "chat", chat })),
          ...sessions.map((session): DirectItem => ({ kind: "session", session })),
        ]
      : null;

  const title =
    mode === "direct"
      ? `Сессии${directItems ? ` · ${directItems.length}` : ""}`
      : `Запуски workflow${runs ? ` · ${runs.length}` : ""}`;

  const loading = mode === "direct" ? chats === null || sessions === null : runs === null;

  const listBody = (height: number) => {
    if (loading) return <Loading />;
    if (mode === "direct") {
      if (!supported && (sessions?.length ?? 0) === 0 && (chats?.length ?? 0) === 0) {
        return <EmptyState size="sm">История сессий установленных рантаймов недоступна.</EmptyState>;
      }
      return (
        <VirtualList
          items={directItems ?? []}
          itemHeight={ROW_HEIGHT}
          height={height}
          ariaLabel="список сессий"
          keyOf={(item) => (item.kind === "chat" ? `chat:${item.chat.id}` : `${item.session.runtime}:${item.session.id}`)}
          empty={<EmptyState size="sm">Чатов и сессий в этой папке пока нет - отправьте первую задачу.</EmptyState>}
          renderRow={(item) => <DirectRow item={item} onOpen={item.kind === "chat" ? () => onOpenChat(item.chat) : () => onOpenSession(item.session)} />}
        />
      );
    }
    return (
      <VirtualList
        items={runs ?? []}
        itemHeight={ROW_HEIGHT}
        height={height}
        ariaLabel="список запусков workflow"
        keyOf={(run) => run.id}
        empty={<EmptyState size="sm">Запусков workflow в этой папке пока нет.</EmptyState>}
        renderRow={(run) => <RunRow run={run} onOpen={() => onOpenRun(run.id)} />}
      />
    );
  };

  const modal = (
    <HistoryModal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      title={title}
      mode={mode}
      supported={supported}
      onRefresh={() => load(cwd)}
      directItems={directItems}
      runs={runs}
      loading={loading}
      onOpenChat={(chat) => {
        setModalOpen(false);
        onOpenChat(chat);
      }}
      onOpenSession={(session) => {
        setModalOpen(false);
        onOpenSession(session);
      }}
      onOpenRun={(id) => {
        setModalOpen(false);
        onOpenRun(id);
      }}
    />
  );

  // collapsed - заголовок остаётся, тело списка анимированно сжимается до нуля
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface/60 p-3">
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1 text-xs font-semibold text-fg transition-colors hover:text-info"
          aria-label={`${title} - открыть историю`}
        >
          {title}
          <ChevronDown
            size={12}
            aria-hidden
            className={`transition-transform duration-300 ${collapsed ? "" : "rotate-180"}`}
          />
        </button>
        <IconButton icon={RefreshCw} label={`Обновить: ${mode === "direct" ? "сессии" : "запуски"}`} onClick={() => load(cwd)} />
      </header>
      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{ maxHeight: collapsed ? 0 : LIST_HEIGHT, opacity: collapsed ? 0 : 1 }}
        aria-hidden={collapsed}
      >
        <div className="pt-2">{listBody(LIST_HEIGHT)}</div>
      </div>
      {modal}
    </section>
  );
}

function HistoryModal({
  open,
  onClose,
  title,
  mode,
  supported,
  onRefresh,
  directItems,
  runs,
  loading,
  onOpenChat,
  onOpenSession,
  onOpenRun,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  mode: "direct" | "workflow";
  supported: boolean;
  onRefresh: () => void;
  directItems: DirectItem[] | null;
  runs: WorkflowRunRecord[] | null;
  loading: boolean;
  onOpenChat: (chat: DirectChatMeta) => void;
  onOpenSession: (session: SessionSummary) => void;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-3xl"
      scroll={false}
      headerActions={<IconButton icon={RefreshCw} label="Обновить" onClick={onRefresh} />}
    >
      {loading ? (
        <Loading />
      ) : mode === "direct" ? (
        !supported && (directItems?.length ?? 0) === 0 ? (
          <EmptyState size="sm">История сессий установленных рантаймов недоступна.</EmptyState>
        ) : (
          <VirtualList
            items={directItems ?? []}
            itemHeight={ROW_HEIGHT}
            height={MODAL_LIST_HEIGHT}
            ariaLabel="история чатов и сессий"
            keyOf={(item) => (item.kind === "chat" ? `chat:${item.chat.id}` : `${item.session.runtime}:${item.session.id}`)}
            empty={<EmptyState size="sm">Чатов и сессий в этой папке пока нет.</EmptyState>}
            renderRow={(item) => (
              <DirectRow item={item} onOpen={item.kind === "chat" ? () => onOpenChat(item.chat) : () => onOpenSession(item.session)} />
            )}
          />
        )
      ) : (
        <VirtualList
          items={runs ?? []}
          itemHeight={ROW_HEIGHT}
          height={MODAL_LIST_HEIGHT}
          ariaLabel="история запусков workflow"
          keyOf={(run) => run.id}
          empty={<EmptyState size="sm">Запусков workflow в этой папке пока нет.</EmptyState>}
          renderRow={(run) => <RunRow run={run} onOpen={() => onOpenRun(run.id)} />}
        />
      )}
      <p className="mt-2 text-[10px] text-fg-faint">
        {mode === "direct"
          ? "Клик по строке: direct-чат откроется в диалоге, сессия рантайма - превью транскрипта."
          : "Клик по строке открывает страницу запуска."}
      </p>
    </Modal>
  );
}
