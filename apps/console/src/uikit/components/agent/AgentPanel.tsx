"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, Loader2, RotateCcw } from "lucide-react";
import type { ModelTier, ProviderDTO } from "@/core/providers";
import { FALLBACK_PROVIDER_ID, MODEL_TIERS } from "@/core/providers";
import type { DirectChatMeta } from "@/core/directChats";
import type { RuntimeSnapshotDTO, SessionSummary } from "@/core/types";
import { dayKey, dayLabel, timeLabel } from "@/lib/format";
import { useConsoleStore } from "@/store/console";
import { Button, IconButton, Notice, Select, Textarea } from "@/uikit";
import { redactComposer } from "@/lib/redactComposer";
import { AgentMessage } from "./AgentMessage";
import { AgentActivityList } from "./AgentActivityList";
import { PromptAutocomplete, type ActiveMenu, type SlashMenuItem } from "./PromptAutocomplete";
import { WorkspaceBar, type GitStatusDTO } from "./WorkspaceBar";
/**
 * Вкладка "Агент" главной страницы. Композер: над полем ввода - рабочая
 * директория и ветка; внизу справа перед кнопкой отправки - исполнитель
 * (рантаймы и провайдеры AI SDK одной группой), модель (4 tiers) и effort.
 * Открытый диалог занимает остаток высоты окна под композером; история
 * (Direct-чаты + сессии рантаймов или запуски workflow) свёрнута в заголовок
 * над композером, клик открывает модальный список. Прямой чат сохраняется
 * локально (POST /api/direct-chats) и открывается из истории; сессия
 * рантайма - превью транскрипта, запуск workflow - страница run.
 * Выполнение - POST /api/agent/chat (стрим UIMessage; обе ветки исполняются
 * как LangGraph-граф: провайдер - LangChain-модель, рантайм - headless-CLI).
 * Выбор исполнителя сохраняется на сервере и восстанавливается при загрузке.
 */

type AgentUIMessage = UIMessage<{ sentAt?: string }>;

type Effort = "low" | "medium" | "high" | "max";

const EFFORT_OPTIONS: readonly { value: Effort; label: string }[] = [
  { value: "low", label: "effort: low" },
  { value: "medium", label: "effort: medium" },
  { value: "high", label: "effort: high" },
  { value: "max", label: "effort: max" },
];

interface WorkspaceDir {
  path: string;
  exists: boolean;
}
interface WorkflowOption { id: string; title: string; nodes: Array<{ id: string; title: string }> }
interface SlashMenuDTO {
  runtimeSkills: Array<{ id: string; name: string; kind: string; source: string; description: string }>;
  sharedSkills: Array<{ id: string; name: string; kind: string; source: string; description: string }>;
  internalSkills: Array<{ id: string; title: string; description: string; tags: string[] }>;
  agents: Array<{ id: string; title: string; folder: string; skills: string[]; description: string }>;
  workflows: Array<{ id: string; title: string; nodeCount: number }>;
  workflowSkills: Array<{ id: string; title: string; description: string }>;
}

/** Effort по умолчанию: thinkingLevel tier у рантайма, medium у провайдера. */
function defaultEffort(executor: string, tier: ModelTier, runtimes: RuntimeSnapshotDTO[]): Effort {
  const vendor = runtimes.find((r) => r.id === executor)?.vendor;
  const level = vendor?.models.find((m) => m.tier === tier)?.thinkingLevel;
  return level === "low" || level === "medium" || level === "high" || level === "max" ? level : "medium";
}

/** id провайдера из значения исполнителя: "provider" - провайдер по умолчанию. */
function executorProviderId(executor: string, defaultProvider: string | null): string | null {
  if (executor === "provider") return defaultProvider ?? FALLBACK_PROVIDER_ID;
  return executor.startsWith("provider:") ? executor.slice("provider:".length) : null;
}

/** Конкретная модель tier для подписи в селекторе. */
function tierModelLabel(
  executor: string,
  tier: ModelTier,
  runtimes: RuntimeSnapshotDTO[],
  providers: ProviderDTO[],
  defaultProvider: string | null,
): string {
  const providerId = executorProviderId(executor, defaultProvider);
  if (providerId) {
    const dto = providers.find((p) => p.id === providerId);
    const model = dto?.entry?.models[tier] || dto?.presetModels[tier];
    return model || "модель не задана";
  }
  const vendor = runtimes.find((r) => r.id === executor)?.vendor;
  return vendor?.models.find((m) => m.tier === tier)?.model ?? "модель не задана";
}

export function AgentPanel({ runtimes }: { runtimes: RuntimeSnapshotDTO[] }) {
  const defaultProvider = useConsoleStore((s) => s.defaultProvider);
  const savedExecutor = useConsoleStore((s) => s.agentExecutor);
  const setAgentExecutor = useConsoleStore((s) => s.setAgentExecutor);
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [dirs, setDirs] = useState<WorkspaceDir[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [git, setGit] = useState<GitStatusDTO | null>(null);
  const [gitVersion, setGitVersion] = useState(0);
  const [executor, setExecutorState] = useState("provider");
  // смена исполнителя сохраняется на сервере: выбор восстанавливается после перезагрузки
  const setExecutor = useCallback((value: string) => {
    setExecutorState(value);
    void setAgentExecutor(value);
  }, [setAgentExecutor]);
  const [tier, setTier] = useState<ModelTier>("standard");
  const [effort, setEffort] = useState<Effort>("medium");
  const [input, setInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowId, setWorkflowId] = useState("direct");
  const [workflowStart, setWorkflowStart] = useState("");
  const [workflowEnd, setWorkflowEnd] = useState("");
  const [slashMenu, setSlashMenu] = useState<SlashMenuDTO | null>(null);
  const [menu, setMenu] = useState<ActiveMenu | null>(null);
  const [menuActive, setMenuActive] = useState(0);
  const [fileBase, setFileBase] = useState("");
  const [fileItems, setFileItems] = useState<SlashMenuItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [workflowRun, setWorkflowRun] = useState<{ id: string; status: string } | null>(null);
  const [redactionNotice, setRedactionNotice] = useState<string | null>(null);
  // время реплик диалога: первый-увиденный штамп и время завершения ответа
  const [times, setTimes] = useState<Record<string, { startedAt?: string; repliedAt?: string }>>({});
  const [runsRefresh, setRunsRefresh] = useState(0);
  // превью транскрипта сессии рантайма (только чтение) вместо активного диалога
  const [transcript, setTranscript] = useState<AgentUIMessage[] | null>(null);
  // идентификатор сохранённого Direct-чата (POST /api/direct-chats)
  const [chatId, setChatId] = useState<string | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  // высота диалога: остаток высоты окна под композером
  const [dialogHeight, setDialogHeight] = useState<number | null>(null);

  const composerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // отложенная очистка контента при сбросе: диалог сначала анимированно закрывается
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [wsRes, prRes, wfRes] = await Promise.all([
          fetch("/api/workspaces", { cache: "no-store" }),
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/workflows", { cache: "no-store" }),
        ]);
        if (wsRes.ok) {
          const json = (await wsRes.json()) as {
            mandatory?: { path: string; exists: boolean };
            additional?: { path: string; exists: boolean }[];
          };
          const list = [
            ...(json.mandatory ? [json.mandatory] : []),
            ...(json.additional ?? []),
          ].filter((d) => d.exists);
          setDirs(list);
          if (list.length > 0) setCwd((prev) => prev || list[0]!.path);
        }
        if (prRes.ok) {
          const json = (await prRes.json()) as { providers?: ProviderDTO[] };
          setProviders((json.providers ?? []).filter((p) => p.status === "active"));
        }
        if (wfRes.ok) setWorkflows(((await wfRes.json()) as { workflows?: WorkflowOption[] }).workflows ?? []);
      } catch {
        /* сеть недоступна - селекторы останутся пустыми */
      }
    })();
  }, []);

  // восстановление сохранённого исполнителя: провайдер должен быть активен, рантайм - известен
  useEffect(() => {
    if (!savedExecutor || savedExecutor === "provider") return;
    if (savedExecutor.startsWith("provider:")) {
      const id = savedExecutor.slice("provider:".length);
      if (providers.some((p) => p.id === id)) setExecutorState(savedExecutor);
    } else if (runtimes.some((r) => r.id === savedExecutor)) {
      setExecutorState(savedExecutor);
    }
  }, [savedExecutor, providers, runtimes]);

  // данные меню slash-команд: навыки исполнителя, внутренние навыки, агенты,
  // навыки workflow - перезагружаются при смене исполнителя, режима или папки
  useEffect(() => {
    let alive = true;
    void fetch(`/api/slash-menu?executor=${encodeURIComponent(executor)}&workflowId=${encodeURIComponent(workflowId)}&workspace=${encodeURIComponent(cwd)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: SlashMenuDTO) => {
        if (alive) setSlashMenu(j);
      })
      .catch(() => {
        if (alive) setSlashMenu(null);
      });
    return () => {
      alive = false;
    };
  }, [executor, workflowId, cwd]);

  // поиск файлов и папок для @-упоминаний: запрос с задержкой 250 мс;
  // клик по папке открывает её (fileBase), вставляется только файл
  useEffect(() => {
    if (!menu || menu.kind !== "file" || !cwd) {
      setFileItems([]);
      setFilesLoading(false);
      return;
    }
    setFilesLoading(true);
    const timer = window.setTimeout(() => {
      const base = fileBase ? `&path=${encodeURIComponent(fileBase)}` : "";
      void fetch(`/api/workspace-files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(menu.query)}${base}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { items?: Array<{ relPath: string; name: string; dir: boolean }> }) => {
          setFileItems((j.items ?? []).map((item) => ({
            group: item.dir ? "Папки (открыть)" : "Файлы рабочей папки",
            token: "@" + item.relPath,
            label: item.name,
            description: item.relPath,
            dir: item.dir,
          })));
          setFilesLoading(false);
        })
        .catch(() => {
          setFileItems([]);
          setFilesLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [menu, cwd, fileBase]);

  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/git/status?dir=${encodeURIComponent(cwd)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as GitStatusDTO;
        if (alive) setGit(json);
      } catch {
        if (alive) setGit(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [cwd, gitVersion]);

  // смена исполнителя или tier сбрасывает effort на значение по умолчанию
  useEffect(() => {
    setEffort(executor.startsWith("provider") ? "medium" : defaultEffort(executor, tier, runtimes));
  }, [executor, tier, runtimes]);

  // transport создаётся один раз; body читает значения через ref - замыкание,
  // созданное в первом рендере, иначе навсегда запомнило бы начальные значения
  // ("provider") и выбор исполнителя не доходил до сервера
  const sendValuesRef = useRef({ executor, tier, effort, cwd });
  useEffect(() => {
    sendValuesRef.current = { executor, tier, effort, cwd };
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: "/api/agent/chat",
        // значения читаются в момент отправки: селекторы могут меняться между репликами
        body: () => {
          const { executor: ex, tier: t, effort: e, cwd: c } = sendValuesRef.current;
          return { executor: ex, tier: t, effort: e, cwd: c || undefined };
        },
      }),
    // transport создаётся один раз; динамические значения - через body-функцию
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat<AgentUIMessage>({ transport });

  const streaming = status === "submitted" || status === "streaming";

  // отметки времени диалога: новое сообщение - время появления, ответ
  // ассистента - время завершения стрима
  useEffect(() => {
    const now = new Date().toISOString();
    setTimes((old) => {
      const next = { ...old };
      let changed = false;
      for (const message of messages) {
        if (!next[message.id]) {
          next[message.id] = { startedAt: now };
          changed = true;
        }
      }
      const last = messages.at(-1);
      if (status === "ready" && last?.role === "assistant" && next[last.id] && !next[last.id]!.repliedAt) {
        next[last.id] = { ...next[last.id]!, repliedAt: now };
        changed = true;
      }
      return changed ? next : old;
    });
  }, [messages, status]);

  // автоскролл диалога вниз при новых частях
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status, transcript]);

  // высота диалога: остаток высоты окна над композером и свёрнутой историей
  useLayoutEffect(() => {
    if (!dialogOpen) {
      setDialogHeight(null);
      return;
    }
    const compute = () => {
      const panel = panelRef.current;
      const composer = composerRef.current;
      if (!panel) return;
      const top = panel.getBoundingClientRect().top;
      const reserved = (composer?.offsetHeight ?? 160) + 96;
      setDialogHeight(Math.max(280, Math.round(window.innerHeight - top - reserved)));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [dialogOpen]);

  // автосохранение Direct-чата: после завершения ответа чат пишется локально
  useEffect(() => {
    if (status !== "ready" || error || transcript || messages.length === 0) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/direct-chats", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: chatId ?? undefined, messages, times }),
          });
          if (!res.ok) return;
          const j = (await res.json()) as { chat?: { id?: string } };
          if (j.chat?.id && j.chat.id !== chatId) {
            setChatId(j.chat.id);
            setHistoryRefresh((v) => v + 1);
          }
        } catch {
          /* сеть недоступна - сохранение повторится после следующей реплики */
        }
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [status, error, transcript, messages, times, chatId]);

  const executorOptions = useMemo(() => {
    const effectiveDefault = defaultProvider ?? FALLBACK_PROVIDER_ID;
    const defaultDto = providers.find((p) => p.id === effectiveDefault);
    const options: { value: string; label: string; group: string }[] = [
      {
        value: "provider",
        label: defaultDto ? `${defaultDto.label} (по умолчанию)` : `Провайдер по умолчанию (${FALLBACK_PROVIDER_ID})`,
        group: "Провайдеры AI SDK",
      },
      ...providers
        .filter((p) => p.id !== effectiveDefault)
        .map((p) => ({ value: `provider:${p.id}`, label: p.label, group: "Провайдеры AI SDK" })),
      ...runtimes
        .filter((r) => r.status !== "disabled")
        .map((r) => ({
          value: r.id,
          label: r.displayName + (r.status === "unknown" ? " (не установлен)" : ""),
          group: "Рантаймы",
        })),
    ];
    return options;
  }, [defaultProvider, providers, runtimes]);

  const modelOptions = useMemo(
    () =>
      MODEL_TIERS.map((t) => ({
        value: t,
        label: `${t} - ${tierModelLabel(executor, t, runtimes, providers, defaultProvider)}`,
      })),
    [executor, runtimes, providers, defaultProvider],
  );

  // пункты slash-меню: нативные навыки (каталоги рантайма - только для runtime-исполнителей,
  // общие harness-навыки - для всех; у провайдера токен /<имя> раскрывает сервер),
  // master-навыки (/master:), workflow (/workflow:), агенты (/agent:) в direct
  const slashItems = useMemo<SlashMenuItem[]>(() => {
    const data = slashMenu;
    if (!data) return [];
    const out: SlashMenuItem[] = [];
    const runtimeExecutor = !executor.startsWith("provider");
    for (const skill of [...(runtimeExecutor ? data.runtimeSkills : []), ...data.sharedSkills]) {
      if (skill.kind !== "skill" && skill.kind !== "script") continue;
      out.push({ group: "Навыки (/имя)", token: "/" + skill.name, label: skill.name, description: skill.description });
    }
    const workflowMode = workflowId !== "direct";
    for (const skill of data.internalSkills) {
      out.push({ group: workflowMode ? "Master skills" : "Master skills (/master:)", token: "/master:" + skill.id, label: skill.title, description: skill.description });
    }
    if (workflowMode) {
      for (const skill of data.workflowSkills) {
        out.push({ group: "Навыки ролей workflow", token: "/master:" + skill.id, label: skill.title, description: skill.description });
      }
    } else {
      for (const workflow of data.workflows ?? []) {
        out.push({ group: "Workflow (/workflow:)", token: "/workflow:" + workflow.id, label: workflow.title, description: workflow.nodeCount + " узл." });
      }
      for (const agent of data.agents) {
        out.push({ group: "Агенты (/agent:)", token: "/agent:" + agent.id, label: agent.title, description: agent.description || agent.folder });
      }
    }
    return [...new Map(out.map((item) => [item.token, item])).values()];
  }, [slashMenu, executor, workflowId]);

  // активные пункты меню: slash - фильтр по подстроке, file - результат поиска
  const menuItems = useMemo<SlashMenuItem[]>(() => {
    if (!menu) return [];
    if (menu.kind === "file") return fileItems;
    const query = menu.query.toLowerCase();
    if (!query) return slashItems.slice(0, 120);
    return slashItems.filter((item) => item.token.toLowerCase().includes(query) || item.label.toLowerCase().includes(query)).slice(0, 120);
  }, [menu, slashItems, fileItems]);

  /** Триггер меню у каретки: "/" или "@" на границе токена. */
  const detectMenu = (text: string, caret: number): ActiveMenu | null => {
    const match = text.slice(0, caret).match(/(^|\s)([/@])([^\s]*)$/);
    if (!match) return null;
    const query = match[3]!;
    return { kind: match[2] === "/" ? "slash" : "file", query, start: caret - query.length - 1, end: caret };
  };

  const syncMenuFromCaret = () => {
    const el = textareaRef.current;
    if (!el) return;
    setMenu(detectMenu(el.value, el.selectionStart ?? el.value.length));
    setMenuActive(0);
  };

  const pickMenuItem = (item: SlashMenuItem) => {
    const el = textareaRef.current;
    const active = menu;
    if (!active) return;
    const caret = el?.selectionStart ?? active.end;
    const insert = item.token + " ";
    const next = input.slice(0, active.start) + insert + input.slice(Math.max(caret, active.end));
    setInput(next);
    setMenu(null);
    setMenuActive(0);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(active.start + insert.length, active.start + insert.length);
    });
  };

  /** Клик по папке в @-результатах: открыть её. */
  const navigateToFileBase = (relPath: string) => {
    setFileBase(relPath);
    setMenuActive(0);
  };

  const navigateUp = () => {
    setFileBase((base) => base.split("/").filter(Boolean).slice(0, -1).join("/"));
    setMenuActive(0);
  };

  // стадии workflow - линейный порядок nodes; диапазон запуска задают start и end, end не может быть перед start
  const stageNodes = useMemo(() => workflows.find((w) => w.id === workflowId)?.nodes ?? [], [workflows, workflowId]);
  const startIdx = workflowStart ? stageNodes.findIndex((n) => n.id === workflowStart) : -1;
  const endIdx = workflowEnd ? stageNodes.findIndex((n) => n.id === workflowEnd) : -1;
  const handleWorkflowStartChange = (value: string) => {
    setWorkflowStart(value);
    const idx = value ? stageNodes.findIndex((n) => n.id === value) : -1;
    // end оказался перед новым start - автокоррекция: end подтягивается к start
    if (idx >= 0 && endIdx >= 0 && idx > endIdx) setWorkflowEnd(value);
  };
  const handleWorkflowEndChange = (value: string) => {
    setWorkflowEnd(value);
    const idx = value ? stageNodes.findIndex((n) => n.id === value) : -1;
    // start оказался после нового end - автокоррекция: start подтягивается к end
    if (idx >= 0 && startIdx >= 0 && idx < startIdx) setWorkflowStart(value);
  };
  const workflowStartOptions = useMemo(
    () => [
      { value: "", label: "Start: начало" },
      // end выбран - стадии после end скрыты
      ...stageNodes.map((n) => ({ value: n.id, label: `Start: ${n.title}` })).filter((_, index) => endIdx < 0 || index <= endIdx),
    ],
    [stageNodes, endIdx],
  );
  const workflowEndOptions = useMemo(
    () => [
      { value: "", label: "End: конец" },
      // start выбран - стадии перед start скрыты
      ...stageNodes.map((n) => ({ value: n.id, label: `End: ${n.title}` })).filter((_, index) => startIdx < 0 || index >= startIdx),
    ],
    [stageNodes, startIdx],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !cwd || transcript) return;
    // Guard: конфиденциальные данные в сообщении заменяются плейсхолдерами,
    // пользователь получает нотификацию; модельная обёртка - второй рубеж.
    const { text: outgoing, notice } = redactComposer(text);
    // /workflow:<id> - запуск существующего workflow прямо из direct-режима
    const workflowRun = text.match(/^\/workflow:([a-z0-9][a-z0-9._-]*)\s*([\s\S]*)$/i);
    if (workflowId !== "direct" || workflowRun) {
      const runWorkflowId = workflowRun ? workflowRun[1]!.toLowerCase() : workflowId;
      const request = workflowRun ? workflowRun[2]!.trim() : outgoing;
      const response = await fetch("/api/workflow-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: cwd, workflowId: runWorkflowId, startNodeId: workflowRun ? undefined : workflowStart || undefined, endNodeId: workflowRun ? undefined : workflowEnd || undefined, title: request.slice(0, 100) || runWorkflowId, input: { request } }) });
      const result = await response.json();
      if (response.ok) {
        const warnings = (result.preflight?.issues ?? []).filter((issue: { severity?: string }) => issue.severity === "warning");
        setWorkflowRun({ id: result.run.id, status: result.run.status + (warnings.length ? ` · warnings: ${warnings.length}` : "") }); setInput("");
      }
      else setWorkflowRun({ id: "preflight", status: [result.error, ...(result.preflight?.issues ?? []).map((issue: { message: string }) => issue.message)].filter(Boolean).join(": ") || "ошибка запуска" });
      setRunsRefresh((v) => v + 1);
      return;
    }
    if (!dialogOpen) {
      cancelPendingReset();
      setDialogOpen(true);
    }
    // slash-команды (/skill:, /agent:) и @-файлы раскрываются на сервере
    void sendMessage({ text: outgoing, metadata: { sentAt: new Date().toISOString() } });
    setInput("");
    setMenu(null);
    if (notice) {
      setRedactionNotice(notice);
      window.setTimeout(() => setRedactionNotice(null), 8000);
    }
  };

  // сброс: контент чистится после анимации закрытия диалога; повторное
  // открытие в этот промежуток отменяет очистку
  const cancelPendingReset = () => {
    if (resetTimer.current === null) return;
    window.clearTimeout(resetTimer.current);
    resetTimer.current = null;
    setMessages([]);
    setTimes({});
    setTranscript(null);
    setChatId(null);
  };

  const resetDialog = () => {
    setDialogOpen(false);
    setWorkflowRun(null);
    setGitVersion((v) => v + 1);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null;
      setMessages([]);
      setTimes({});
      setTranscript(null);
      setChatId(null);
    }, 380);
  };

  // штамп реплики для отображения: пользователь - время отправки,
  // ассистент - время завершения ответа
  const messageIso = (message: AgentUIMessage): string | undefined =>
    message.role === "user"
      ? message.metadata?.sentAt ?? times[message.id]?.startedAt
      : times[message.id]?.repliedAt ?? times[message.id]?.startedAt;

  // история: direct-чат возвращается в диалог, сессия рантайма - превью
  const openDirectChat = async (chat: DirectChatMeta) => {
    try {
      const res = await fetch(`/api/direct-chats?id=${encodeURIComponent(chat.id)}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        chat?: { id: string; messages: AgentUIMessage[]; times?: Record<string, { startedAt?: string; repliedAt?: string }> };
      };
      if (!j.chat) return;
      cancelPendingReset();
      setTranscript(null);
      setChatId(j.chat.id);
      setTimes(j.chat.times ?? {});
      setMessages(j.chat.messages);
      setDialogOpen(true);
    } catch {
      /* чат недоступен */
    }
  };

  const openRuntimeSession = async (session: SessionSummary) => {
    try {
      const res = await fetch(`/api/sessions?runtime=${encodeURIComponent(session.runtime)}&id=${encodeURIComponent(session.id)}`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { detail?: { excerpt?: Array<{ role: "user" | "assistant" | "system"; text: string }> } };
      const excerpt = j.detail?.excerpt ?? [];
      cancelPendingReset();
      setChatId(null);
      setTimes({});
      setTranscript(
        excerpt.length > 0
          ? excerpt.map((m, i) => ({ id: `preview-${i}`, role: m.role, parts: [{ type: "text", text: m.text }] }) as AgentUIMessage)
          : [{ id: "preview-empty", role: "assistant", parts: [{ type: "text", text: "Транскрипт недоступен для этого формата лога - полные данные в файле сессии." }] } as AgentUIMessage],
      );
      setDialogOpen(true);
    } catch {
      /* сессия недоступна */
    }
  };

  const openRun = (runId: string) => {
    window.location.href = `/workflows/runs/${runId}`;
  };

  const shownMessages = transcript ?? messages;

  return (
    <div ref={panelRef} className="flex min-h-[420px] flex-col">
      {/* диалог: окно появляется и закрывается анимацией высоты */}
      <div
        className="overflow-hidden transition-[height,opacity] duration-300 ease-out"
        style={{ height: dialogOpen ? (dialogHeight ?? 280) : 0, opacity: dialogOpen ? 1 : 0 }}
        aria-hidden={!dialogOpen}
      >
        <div
          ref={scrollRef}
          className="mt-3 h-[calc(100%-0.75rem)] space-y-4 overflow-y-auto rounded-xl border border-line bg-page/40 p-4"
        >
          {shownMessages.map((message, index) => {
            const iso = messageIso(message);
            const prevIso = index > 0 ? messageIso(shownMessages[index - 1]!) : undefined;
            const dayChanged = iso && (!prevIso || dayKey(iso) !== dayKey(prevIso));
            return (
              <Fragment key={message.id}>
                {iso && dayChanged ? (
                  <div className="flex items-center gap-3" role="separator">
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[10px] text-fg-faint">{dayLabel(iso)}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                ) : null}
                <AgentMessage message={message} time={iso ? timeLabel(iso) : null} />
              </Fragment>
            );
          })}
          {!transcript && streaming && messages.at(-1)?.role === "assistant" ? (
            <p className="flex items-center gap-1.5 text-[11px] text-fg-faint">
              <Loader2 size={12} aria-hidden className="animate-spin" /> выполняется…
            </p>
          ) : null}
          {!transcript && error ? (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error.message}
            </p>
          ) : null}
        </div>
      </div>

      {redactionNotice ? <div className="mb-3"><Notice tone="info">{redactionNotice}</Notice></div> : null}
      {!dialogOpen && workflowRun ? (
        <p className="mb-3 text-center text-xs">
          <a className="text-info underline" href={workflowRun.id === "preflight" ? "#" : `/workflows/runs/${workflowRun.id}`}>{workflowRun.id}: {workflowRun.status}</a>
        </p>
      ) : null}

      <div ref={composerRef} className="mt-3 rounded-xl border border-line bg-surface/60 p-3">
        <WorkspaceBar
          dirs={dirs}
          cwd={cwd}
          onCwd={(dir) => setCwd(dir)}
          git={git}
          onBranchChange={() => setGitVersion((v) => v + 1)}
          disabled={streaming}
        />
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setMenu(detectMenu(e.target.value, e.target.selectionStart ?? e.target.value.length));
            setMenuActive(0);
          }}
          onSelect={syncMenuFromCaret}
          onKeyDown={(e) => {
            if (menu && menuItems.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMenuActive((index) => (index + 1) % menuItems.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMenuActive((index) => (index - 1 + menuItems.length) % menuItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMenuItem(menuItems[Math.min(menuActive, menuItems.length - 1)]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={transcript
            ? "Просмотр сессии - нажмите Новый диалог, чтобы продолжить своим промтом"
            : cwd ? "Опишите задачу агенту… (/ - навыки, агенты и workflow; @ - файлы и папки; Enter - отправить)" : "Загрузка рабочих папок…"}
          rows={3}
          className="mt-2 w-full resize-none border-0 bg-transparent px-1 text-sm focus:outline-none"
          aria-label="промт агенту"
          disabled={!cwd || transcript !== null}
        />
        {menu ? (
          <PromptAutocomplete
            items={menuItems}
            activeIndex={Math.min(menuActive, Math.max(menuItems.length - 1, 0))}
            loading={menu.kind === "file" && filesLoading}
            canNavigateUp={menu.kind === "file" && Boolean(fileBase)}
            onHover={setMenuActive}
            onPick={pickMenuItem}
            onNavigate={navigateToFileBase}
            onNavigateUp={navigateUp}
            onClose={() => setMenu(null)}
          />
        ) : null}
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="flex flex-wrap items-center justify-start gap-1.5">
            {dialogOpen ? (
              <IconButton icon={RotateCcw} label="Новый диалог" onClick={resetDialog} disabled={streaming} />
            ) : null}
            <Select value={workflowId} onChange={(value) => {
              setWorkflowId(value);
              // при выборе workflow подставляется диапазон по умолчанию: start - первый узел, end - последний
              const nodes = workflows.find((w) => w.id === value)?.nodes ?? [];
              setWorkflowStart(nodes[0]?.id ?? "");
              setWorkflowEnd(nodes[nodes.length - 1]?.id ?? "");
            }} size="sm" className="w-48" ariaLabel="workflow" options={[{ value: "direct", label: "Direct" }, ...workflows.map((w) => ({ value: w.id, label: w.title }))]} disabled={streaming} />
            {workflowId !== "direct" ? <>
              <Select value={workflowStart} onChange={handleWorkflowStartChange} size="sm" className="w-52" ariaLabel="начальная стадия workflow" options={workflowStartOptions} />
              <Select value={workflowEnd} onChange={handleWorkflowEndChange} size="sm" className="w-52" ariaLabel="конечная стадия workflow" options={workflowEndOptions} />
            </> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {workflowId === "direct" ? <>
              <Select
                value={executor}
                onChange={setExecutor}
                size="sm"
                className="w-56"
                ariaLabel="исполнитель: рантайм или провайдер"
                options={executorOptions}
                disabled={streaming}
              />
              <Select
                value={tier}
                onChange={(value) => setTier(value as ModelTier)}
                size="sm"
                className="w-52"
                ariaLabel="модель по tier"
                options={modelOptions}
                disabled={streaming}
              />
              <Select
                value={effort}
                onChange={(value) => setEffort(value as Effort)}
                size="sm"
                className="w-36"
                ariaLabel="уровень усилий"
                options={EFFORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                disabled={streaming}
              />
            </> : null}
            <Button variant="primary" size="sm" onClick={() => void send()} disabled={!input.trim() || streaming || !cwd || transcript !== null}>
              {streaming ? <Loader2 size={13} aria-hidden className="animate-spin" /> : <ArrowUp size={13} aria-hidden />}
              Отправить
            </Button>
          </div>
        </div>
      </div>

      <AgentActivityList
        mode={workflowId === "direct" ? "direct" : "workflow"}
        cwd={cwd}
        refreshToken={workflowId === "direct" ? historyRefresh : runsRefresh}
        collapsed={dialogOpen}
        onOpenChat={(chat) => void openDirectChat(chat)}
        onOpenSession={(session) => void openRuntimeSession(session)}
        onOpenRun={openRun}
      />
    </div>
  );
}
