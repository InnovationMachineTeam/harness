"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, ListTree, Play, RefreshCw, Unlink, Wand2 } from "lucide-react";
import { confirmDialog } from "@/uikit";
import { BrandEditor } from "@/uikit/components/design/BrandEditor";
import { ComponentsManager } from "@/uikit/components/design/ComponentsManager";
import { DesignGuideEditor } from "@/uikit/components/design/DesignGuideEditor";
import { DesignSkillsPanel } from "@/uikit/components/design/DesignSkillsPanel";
import { DesignTokensEditor } from "@/uikit/components/design/DesignTokensEditor";
import { UiKitEditor } from "@/uikit/components/design/UiKitEditor";
import { postJson, type PackStatus } from "@/uikit/components/design/design-api";
import {
  Button,
  Chip,
  EmptyState,
  FieldLabel,
  Footnote,
  Loading,
  Notice,
  Panel,
  Select,
  Tabs,
  Textarea,
  type SelectOption,
} from "@/uikit";

/**
 * Вкладка "Дизайн" - рабочее место дизайн-контекста обязательной директории:
 * состояние пакета (DESIGN.md, BRAND.md, ui-kit, components), провайдеры
 * дизайна (Claude Design, Open Design, Figma MCP), единый запуск задач
 * (рантайм/провайдер/сессия) с шаблонами контуров, редакторы DESIGN.md и
 * BRAND.md, артефакты open-design и инструменты дизайна (MCP-пресеты).
 * Тема самой консоли - "Настройки → Внешний вид".
 */

interface ThemeIndexEntry {
  file: string;
  name: string;
  mode: "dark" | "light";
}

interface McpServerInfo {
  name: string;
  enabled: boolean;
}

interface McpPresetInfo {
  name: string;
  displayName: string;
  description: string;
  transport: unknown;
  category?: "design";
}

type TargetKind = "runtime" | "provider" | "session";

/** Внутренние вклады раздела "Дизайн". */
type DesignTab = "overview" | "tokens" | "guide" | "brand" | "uikit" | "components" | "skills" | "tools";

const DESIGN_TABS: { key: DesignTab; label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "tokens", label: "Токены" },
  { key: "guide", label: "Гайд" },
  { key: "brand", label: "Бренд" },
  { key: "uikit", label: "UIKit" },
  { key: "components", label: "Компоненты" },
  { key: "skills", label: "Навыки" },
  { key: "tools", label: "Инструменты" },
];

interface RunResult {
  kind: "runtime" | "provider" | "session";
  ok: boolean;
  detail?: string;
  logFile?: string;
  text?: string;
  output?: string;
  error?: string;
}

interface Contour {
  label: string;
  targetKind: TargetKind;
  runtimeId: string;
  prompt: string;
}

const RUNTIMES: SelectOption[] = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "codex", label: "Codex CLI" },
  { value: "kimi", label: "Kimi Code" },
  { value: "zcode", label: "ZCode" },
];

const DESIGN_TOOLS_ROWS: { key: string; label: string }[] = [
  { key: "claude-design", label: "Claude Design" },
  { key: "open-design", label: "Open Design" },
  { key: "figma", label: "Figma MCP" },
];

/** Дизайн-контуры: шаблон = исполнитель + промт. */
const CONTOURS: Contour[] = [
  {
    label: "Обновить кит из DESIGN.md",
    targetKind: "runtime",
    runtimeId: "claude",
    prompt:
      "Обнови примитивы кита по токенам DESIGN.md для web (React + Tailwind) и mobile (React Native); новые и изменённые компоненты внеси в design/components.json.",
  },
  {
    label: "Компонент из макета Figma",
    targetKind: "provider",
    runtimeId: "claude",
    prompt:
      "Воплоти компонент <имя> из макета Figma (MCP figma): прочитай макет, собери по токенам DESIGN.md и правилам design/ui-kit.md, добавь в кит и design/components.json.",
  },
  {
    label: "Аудит интерфейса по токенам",
    targetKind: "runtime",
    runtimeId: "claude",
    prompt:
      "Сделай скриншоты ключевых экранов (Playwright/chrome-devtools MCP), сверь их с DESIGN.md и design/ui-kit.md: находки - списком с приоритетами, критичные расхождения исправь сразу.",
  },
  {
    label: "Бренд-паспорт из open-design",
    targetKind: "provider",
    runtimeId: "claude",
    prompt:
      "Собери BRAND.md из артефактов open-design (MCP open-design: list_projects, get_artifact): имя и суть, аудитория, тон коммуникации, фирменные элементы; палитру сверь с DESIGN.md.",
  },
];

export function DesignWorkspace({ mandatoryDir }: { mandatoryDir: string }) {
  const [tab, setTab] = useState<DesignTab>("overview");
  const [status, setStatus] = useState<PackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [themeIndex, setThemeIndex] = useState<ThemeIndexEntry[]>([]);
  const [presetFile, setPresetFile] = useState("");

  const [targetKind, setTargetKind] = useState<TargetKind>("runtime");
  const [runtimeId, setRuntimeId] = useState("claude");
  const [providerId, setProviderId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<{ id: string; lastActivityAt: string; titleHint?: string }[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const [artifacts, setArtifacts] = useState<string | null>(null);
  const [artifactsBusy, setArtifactsBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!mandatoryDir) return;
    try {
      const data = await fetch(`/api/design/workspace?dir=${encodeURIComponent(mandatoryDir)}`).then((r) => r.json());
      if (data.error) throw new Error(data.error);
      setStatus(data as PackStatus);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [mandatoryDir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    fetch("/api/design")
      .then((r) => r.json())
      .then((data: { themeIndex?: ThemeIndexEntry[] }) => setThemeIndex(data.themeIndex ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (targetKind !== "session" || !mandatoryDir) return;
    fetch(`/api/sessions?runtime=${encodeURIComponent(runtimeId)}&dir=${encodeURIComponent(mandatoryDir)}`)
      .then((r) => r.json())
      .then((data: { sessions?: { id: string; lastActivityAt: string; titleHint?: string }[] }) => {
        const list = data.sessions ?? [];
        setSessions(list);
        setSessionId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
      })
      .catch(() => setSessions([]));
  }, [targetKind, runtimeId, mandatoryDir]);

  const afterAction = useCallback(async () => {
    await reload();
    setRevision((value) => value + 1);
  }, [reload]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await postJson("/api/design/workspace", { dir: mandatoryDir, ...body });
      await afterAction();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** Префилл задачи контуром-шаблоном. */
  const prefill = (contour: { targetKind: TargetKind; runtimeId: string; prompt: string }) => {
    setTargetKind(contour.targetKind);
    setRuntimeId(contour.runtimeId);
    setPrompt(contour.prompt);
  };

  const prefillProvider = (tool: "claude-design" | "open-design" | "figma") => {
    const providers = status?.providers ?? [];
    if (tool === "claude-design") {
      prefill({
        targetKind: "runtime",
        runtimeId: "claude",
        prompt:
          "Проведи дизайн-сессию по брифу <бриф>: если доступна команда Claude Design (/design) - используй её (канва вариантов, выбор, реализация); иначе предложи 2-3 варианта сам. Токены занеси в DESIGN.md, смысловой слой бренда - в BRAND.md.",
      });
      return;
    }
    if (providers.length > 0) {
      setProviderId((current) => current || providers[0]!);
      setTargetKind("provider");
    } else {
      setTargetKind("runtime");
      setRuntimeId("claude");
    }
    setPrompt(
      tool === "open-design"
        ? "Открой проекты open-design (MCP open-design: list_projects, get_artifact), возьми артефакты текущего проекта и обнови по ним BRAND.md (смысловой слой) и DESIGN.md (токены)."
        : "Воплоти компонент <имя> из макета Figma (MCP figma): прочитай макет, собери по токенам DESIGN.md и правилам design/ui-kit.md, добавь в кит и design/components.json.",
    );
  };

  const run = async () => {
    if (!prompt.trim()) return;
    const target =
      targetKind === "runtime" ? { kind: "runtime", id: runtimeId }
      : targetKind === "provider" ? { kind: "provider", id: providerId || (status?.providers[0] ?? "") }
      : { kind: "session", runtime: runtimeId, sessionId };
    setRunning(true);
    setRunResult(null);
    try {
      const result = await postJson<RunResult>("/api/design/run", { dir: mandatoryDir, prompt, target });
      setRunResult(result);
    } catch (cause) {
      setRunResult({ kind: target.kind as RunResult["kind"], ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setRunning(false);
    }
  };

  const loadArtifacts = async () => {
    setArtifactsBusy(true);
    try {
      const data = await postJson<{ tools?: string[]; list?: { tool: string; ok: boolean; output: string } | null; error?: string }>(
        "/api/design/artifacts",
        { dir: mandatoryDir },
      );
      if (data.error) setArtifacts(data.error);
      else if (data.list) setArtifacts(`${data.list.tool}: ${data.list.output}`);
      else setArtifacts(`Инструменты open-design: ${(data.tools ?? []).join(", ") || "нет"}`);
    } catch (cause) {
      setArtifacts(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setArtifactsBusy(false);
    }
  };

  if (!mandatoryDir) {
    return <EmptyState>Обязательная рабочая папка не настроена - задайте её в "Настройках → Рабочих папках".</EmptyState>;
  }

  const presetOptions: SelectOption[] = themeIndex.map((item) => ({
    value: item.file,
    label: `${item.name} (${item.mode === "dark" ? "тёмная" : "светлая"})`,
  }));
  const providerOptions: SelectOption[] = (status?.providers ?? []).map((id) => ({ value: id, label: id }));
  const sessionOptions: SelectOption[] = sessions.map((item) => ({
    value: item.id,
    label: `${item.titleHint ?? item.id} · ${new Date(item.lastActivityAt).toLocaleString()}`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Footnote>
        Рабочая директория: <span className="font-mono text-fg-muted">{mandatoryDir}</span> (обязательная папка; меняется в
        "Настройках → Рабочих папках"). Контекст синхронизируется в CLAUDE.md и AGENTS.md этой папки.
      </Footnote>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!status ? (
        <Loading>читаем дизайн-контекст папки…</Loading>
      ) : (
        <>
          <Tabs tabs={DESIGN_TABS} active={tab} onChange={setTab} className="border-b border-line/60 pb-2" />

          {tab === "overview" ? (
            <div className="flex flex-col gap-4">
              <PackPanel status={status} busy={busy} presetOptions={presetOptions} presetFile={presetFile} setPresetFile={setPresetFile} act={act} />
              <ProvidersPanel status={status} onTask={prefillProvider} />
              <TaskPanel
                targetKind={targetKind}
                setTargetKind={setTargetKind}
                runtimeId={runtimeId}
                setRuntimeId={setRuntimeId}
                providerOptions={providerOptions}
                providerId={providerId}
                setProviderId={setProviderId}
                sessionOptions={sessionOptions}
                sessionId={sessionId}
                setSessionId={setSessionId}
                prompt={prompt}
                setPrompt={setPrompt}
                running={running}
                runResult={runResult}
                run={run}
              />
              <ArtifactsPanel busy={artifactsBusy} artifacts={artifacts} load={loadArtifacts} enabled={status.sync.enabledMcp.includes("open-design")} />
            </div>
          ) : null}
          {tab === "tokens" ? (
            <DesignTokensEditor dir={mandatoryDir} design={status.pack.design} presets={themeIndex} revision={revision} onSaved={afterAction} />
          ) : null}
          {tab === "guide" ? (
            <DesignGuideEditor dir={mandatoryDir} design={status.pack.design} revision={revision} onSaved={afterAction} />
          ) : null}
          {tab === "brand" ? (
            <BrandEditor
              dir={mandatoryDir}
              brand={status.pack.brand}
              content={status.pack.brand.content}
              revision={revision}
              onSaved={afterAction}
              onTask={() => {
                prefillProvider("open-design");
                setTab("overview");
              }}
            />
          ) : null}
          {tab === "uikit" ? (
            <UiKitEditor dir={mandatoryDir} uikit={status.pack.uikit} content={status.pack.uikit.content} revision={revision} onSaved={afterAction} />
          ) : null}
          {tab === "components" ? (
            <ComponentsManager
              dir={mandatoryDir}
              components={status.pack.components}
              manifest={status.pack.components.manifest}
              revision={revision}
              onSaved={afterAction}
            />
          ) : null}
          {tab === "skills" ? (
            <DesignSkillsPanel
              onUse={(name) => {
                setPrompt((current) => (current.includes(`навык ${name}`) ? current : `Используй навык ${name}. ${current}`.trim()));
                setTab("overview");
              }}
            />
          ) : null}
          {tab === "tools" ? <DesignToolsPanel onChanged={afterAction} /> : null}
        </>
      )}
    </div>
  );
}

function PackPanel(props: {
  status: PackStatus;
  busy: boolean;
  presetOptions: SelectOption[];
  presetFile: string;
  setPresetFile: (value: string) => void;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { status, busy, presetOptions, presetFile, setPresetFile, act } = props;
  const { pack, sync } = status;
  const components = pack.components.manifest;
  return (
    <Panel
      title="Design pack"
      actions={
        <>
          {pack.design.exists ? (
            <Button variant="accent" disabled={busy} onClick={() => void act({ action: "sync" })}>
              <Link2 size={12} aria-hidden /> Синхронизировать в рантаймы
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || !presetFile} onClick={() => void act({ action: "init", presetFile })}>
              <Wand2 size={12} aria-hidden /> Создать из пресета
            </Button>
          )}
          {sync.targets.some((target) => target.synced) ? (
            <Button variant="ghostDim" disabled={busy} onClick={() => void act({ action: "desync" })}>
              <Unlink size={12} aria-hidden /> Убрать блоки
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={pack.design.exists ? (pack.design.lintErrors > 0 ? "red" : "emerald") : "dashed"}>
          {pack.design.exists
            ? `DESIGN.md · ${pack.design.name}${pack.design.lintErrors > 0 ? ` · lint: ${pack.design.lintErrors} ошиб.` : ""}${pack.design.lintWarnings > 0 ? ` · ${pack.design.lintWarnings} предупр.` : ""}`
            : "DESIGN.md отсутствует"}
        </Chip>
        <Chip tone={pack.brand.exists ? "emerald" : "dashed"}>BRAND.md{pack.brand.exists ? "" : " отсутствует"}</Chip>
        <Chip tone={pack.uikit.exists ? "neutral" : "dashed"}>design/ui-kit.md {pack.uikit.exists ? "" : "отсутствует"}</Chip>
        <Chip tone={pack.components.exists ? "neutral" : "dashed"}>
          components.json{components ? ` · web ${components.web.length}, mobile ${components.mobile.length}` : ""}
        </Chip>
        {sync.targets.map((target) => (
          <Chip key={target.file} tone={target.synced ? "sky" : "dim"}>
            {target.file} {target.synced ? "синхронизирован" : "без блока"}
          </Chip>
        ))}
        {sync.enabledMcp.map((name) => (
          <Chip key={name} tone="emerald">
            MCP: {name}
          </Chip>
        ))}
        {sync.missingMcp.map((name) => (
          <Chip key={name} tone="dim">
            MCP: {name} выключен
          </Chip>
        ))}
      </div>
      {pack.design.exists && components !== null ? (
        <div className="mt-3">
          <Button variant="ghostDim" size="sm" disabled={busy} onClick={() => void act({ action: "scan-components" })}>
            <ListTree size={12} aria-hidden /> Пересканировать компоненты
          </Button>
        </div>
      ) : null}
      {!pack.design.exists && presetOptions.length > 0 ? (
        <div className="mt-3 max-w-72">
          <FieldLabel htmlFor="design-preset">Пресет темы (themes/ консоли)</FieldLabel>
          <Select id="design-preset" value={presetFile} options={presetOptions} onChange={setPresetFile} />
        </div>
      ) : null}
    </Panel>
  );
}

function ProvidersPanel(props: { status: PackStatus; onTask: (tool: "claude-design" | "open-design" | "figma") => void }) {
  return (
    <Panel title="Провайдеры дизайна">
      <div className="space-y-2">
        {DESIGN_TOOLS_ROWS.map((row) => {
          const tool = props.status.designTools?.[row.key];
          if (!tool) return null;
          return (
            <div key={row.key} className="flex flex-wrap items-center gap-2 text-xs">
              <Chip tone={tool.ready ? "emerald" : "dim"}>{tool.ready ? "готов" : "не готов"}</Chip>
              <span className="font-medium text-fg">{row.label}</span>
              <span className="min-w-0 flex-1 text-[11px] text-fg-faint">{tool.detail}</span>
              <Button variant="ghostDim" size="sm" onClick={() => props.onTask(row.key as "claude-design" | "open-design" | "figma")}>
                Задача
              </Button>
            </div>
          );
        })}
      </div>
      <Footnote className="mt-2">Порядок провайдеров для задач - настройка "Workflow → Design providers"; MCP-серверы включаются в "Настройках → MCP".</Footnote>
    </Panel>
  );
}

function TaskPanel(props: {
  targetKind: TargetKind;
  setTargetKind: (value: TargetKind) => void;
  runtimeId: string;
  setRuntimeId: (value: string) => void;
  providerOptions: SelectOption[];
  providerId: string;
  setProviderId: (value: string) => void;
  sessionOptions: SelectOption[];
  sessionId: string;
  setSessionId: (value: string) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  running: boolean;
  runResult: RunResult | null;
  run: () => Promise<void>;
}) {
  const kindOptions: SelectOption[] = [
    { value: "runtime", label: "Рантайм (новая сессия)" },
    { value: "provider", label: "Провайдер (агентный цикл)" },
    { value: "session", label: "Отдельная сессия (resume)" },
  ];
  return (
    <Panel title="Задача">
      <div className="flex flex-wrap gap-2">
        {CONTOURS.map((contour) => (
          <Button
            key={contour.label}
            variant="ghostDim"
            size="xs"
            onClick={() => {
              props.setTargetKind(contour.targetKind);
              props.setRuntimeId(contour.runtimeId);
              props.setPrompt(contour.prompt);
            }}
          >
            {contour.label}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <FieldLabel htmlFor="design-target">Исполнитель</FieldLabel>
          <Select id="design-target" value={props.targetKind} options={kindOptions} onChange={(value) => props.setTargetKind(value as TargetKind)} />
        </div>
        {props.targetKind !== "provider" ? (
          <div className="min-w-44">
            <FieldLabel htmlFor="design-runtime">Рантайм</FieldLabel>
            <Select id="design-runtime" value={props.runtimeId} options={RUNTIMES} onChange={props.setRuntimeId} />
          </div>
        ) : null}
        {props.targetKind === "provider" ? (
          <div className="min-w-44">
            <FieldLabel htmlFor="design-provider">Провайдер</FieldLabel>
            {props.providerOptions.length > 0 ? (
              <Select id="design-provider" value={props.providerId || props.providerOptions[0]!.value} options={props.providerOptions} onChange={props.setProviderId} />
            ) : (
              <Notice tone="info">Нет активных провайдеров - пройдите проверку на вкладке "Провайдеры".</Notice>
            )}
          </div>
        ) : null}
        {props.targetKind === "session" ? (
          <div className="min-w-72">
            <FieldLabel htmlFor="design-session">Сессия в этой папке</FieldLabel>
            {props.sessionOptions.length > 0 ? (
              <Select id="design-session" value={props.sessionId} options={props.sessionOptions} onChange={props.setSessionId} />
            ) : (
              <Notice tone="info">Сессий этого рантайма в папке нет - запустите рантайм из директории.</Notice>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-3">
        <Textarea
          aria-label="Промт дизайн-задачи"
          rows={4}
          value={props.prompt}
          onChange={(event) => props.setPrompt(event.target.value)}
          placeholder="Например: собери primary-кнопку и карточку товара по токенам DESIGN.md для web; обнови design/components.json."
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="accent" disabled={props.running || !props.prompt.trim()} onClick={() => void props.run()}>
          <Play size={12} aria-hidden /> {props.running ? "Задача выполняется…" : "Запустить"}
        </Button>
      </div>
      {props.runResult ? (
        <div className="mt-3">
          <Notice tone={props.runResult.ok ? "success" : "error"}>
            {props.runResult.ok
              ? props.runResult.kind === "runtime"
                ? props.runResult.detail
                : props.runResult.kind === "provider"
                  ? (props.runResult.text || "провайдер завершил задачу").slice(0, 2_000)
                  : (props.runResult.output || "сессия ответила").slice(0, 2_000)
              : (props.runResult.error ?? "задача не выполнена")}
            {props.runResult.logFile ? ` Лог: ${props.runResult.logFile}` : ""}
          </Notice>
        </div>
      ) : null}
    </Panel>
  );
}

function ArtifactsPanel(props: { busy: boolean; artifacts: string | null; load: () => Promise<void>; enabled: boolean }) {
  return (
    <Panel
      title="Артефакты open-design"
      actions={
        <Button variant="ghostDim" disabled={props.busy} onClick={() => void props.load()}>
          <RefreshCw size={12} aria-hidden /> Обновить
        </Button>
      }
    >
      {!props.enabled ? (
        <Notice tone="info">Сервер open-design выключен в реестре MCP - включите его в "Настройках → MCP" или ниже в "Инструментах дизайна" (desktop-приложение Open Design должно быть запущено).</Notice>
      ) : props.artifacts ? (
        <pre className="max-h-64 overflow-auto rounded-lg bg-page/60 p-3 text-[11px] leading-relaxed text-fg-muted">{props.artifacts}</pre>
      ) : (
        <EmptyState size="sm">Нажмите "Обновить" - консоль вызовет list-инструмент open-design для этой папки.</EmptyState>
      )}
    </Panel>
  );
}

/** Инструменты дизайна: design-пресеты каталога MCP со статусом и включением. */
function DesignToolsPanel(props: { onChanged: () => Promise<void> }) {
  const [presets, setPresets] = useState<McpPresetInfo[] | null>(null);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadTools = useCallback(async () => {
    try {
      const [catalog, registry] = await Promise.all([
        fetch("/api/mcp/catalog").then((r) => r.json()),
        fetch("/api/mcp").then((r) => r.json()),
      ]);
      setPresets(((catalog.presets ?? []) as McpPresetInfo[]).filter((preset) => preset.category === "design"));
      setServers((registry.servers ?? []) as McpServerInfo[]);
    } catch {
      setPresets([]);
    }
  }, []);

  useEffect(() => {
    void reloadTools();
  }, [reloadTools]);

  const toggle = async (preset: McpPresetInfo, action: "install" | "enable" | "disable") => {
    const consequences: Record<string, string> = {
      install: `Сервер "${preset.name}" войдёт в глобальный реестр MCP включённым и будет синхронизирован: запись появится в проектном .mcp.json и пользовательских конфигах рантаймов (claude, codex, cursor, opencode). Выполнится hook install, если он объявлен.`,
      enable: `Сервер "${preset.name}" будет включён в синке: запись появится в проектном .mcp.json и пользовательских конфигах рантаймов. Выполнится hook enable, если он объявлен.`,
      disable: `Сервер "${preset.name}" будет удалён из файлов синка (проектный .mcp.json, конфиги рантаймов); запись в реестре сохранится - вернуть можно включением. Выполнится hook disable, если он объявлен.`,
    };
    if (!(await confirmDialog({ title: `MCP: ${action} - ${preset.name}`, message: consequences[action], confirmLabel: "Продолжить" }))) {
      return;
    }
    setBusy(preset.name);
    setError(null);
    try {
      if (action === "install") {
        await postJson("/api/mcp", { name: preset.name, transport: preset.transport });
      } else {
        await fetch(`/api/mcp`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: preset.name, enabled: action === "enable" }),
        });
      }
      await reloadTools();
      await props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Инструменты дизайна">
      {presets === null ? (
        <Loading>читаем каталог MCP…</Loading>
      ) : presets.length === 0 ? (
        <EmptyState size="sm">Design-пресеты каталога не найдены.</EmptyState>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => {
            const server = servers.find((item) => item.name === preset.name);
            const state = !server ? "none" : server.enabled ? "on" : "off";
            return (
              <div key={preset.name} className="flex flex-wrap items-center gap-2 text-xs">
                <Chip tone={state === "on" ? "emerald" : state === "off" ? "dim" : "dashed"}>
                  {state === "on" ? "включён" : state === "off" ? "выключен" : "не установлен"}
                </Chip>
                <span className="font-medium text-fg">{preset.displayName}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-faint" title={preset.description}>{preset.description}</span>
                {state === "none" ? (
                  <Button variant="ghostDim" size="sm" disabled={busy === preset.name} onClick={() => void toggle(preset, "install")}>
                    Установить
                  </Button>
                ) : state === "off" ? (
                  <Button variant="ghostDim" size="sm" disabled={busy === preset.name} onClick={() => void toggle(preset, "enable")}>
                    Включить
                  </Button>
                ) : (
                  <Button variant="ghostDim" size="sm" disabled={busy === preset.name} onClick={() => void toggle(preset, "disable")}>
                    Выключить
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      <Footnote className="mt-2">Полное управление серверами (транспорт, заголовки, override по рантаймам) - "Настройки → MCP".</Footnote>
    </Panel>
  );
}
