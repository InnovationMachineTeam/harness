"use client";

import { useCallback, useEffect, useState } from "react";
import type { ToolStatusDTO } from "@/core/tools";
import { Button, Chip, Modal, Notice, Segmented, Select, Toggle } from "@/ui/UIKit";

interface InstallParamsState {
  scope: "global" | "project";
  strict: boolean;
  indexWorkspaces: boolean;
  mode: "wrap" | "mcp";
}

const DEFAULT_PARAMS: InstallParamsState = { scope: "project", strict: false, indexWorkspaces: true, mode: "wrap" };

interface StepPreview {
  label: string;
  command: string[];
}

/**
 * Модалка установки инструмента: режим (Headroom), рантаймы (по умолчанию все
 * поддерживаемые), параметры (scope/strict/индексация) и предпросмотр команд
 * (dryRun /api/tools/action). Установка идёт job'ом - терминал показывает родитель.
 */
export function ToolInstallModal({
  tool,
  open,
  packageManager,
  onClose,
  onStarted,
}: {
  tool: ToolStatusDTO | null;
  open: boolean;
  packageManager: "bun" | "npm";
  onClose: () => void;
  /** jobId запущенного job'а установки. */
  onStarted: (jobId: string) => void;
}) {
  const [runtimes, setRuntimes] = useState<string[]>([]);
  const [params, setParams] = useState<InstallParamsState>(DEFAULT_PARAMS);
  const [preview, setPreview] = useState<StepPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !tool) return;
    setRuntimes(tool.perRuntime?.supported.map((r) => r.id) ?? []);
    setParams({ ...DEFAULT_PARAMS, ...(tool.installedRecord?.params ?? {}) });
    setPreview(null);
    setError(null);
  }, [open, tool]);

  const loadPreview = useCallback(async () => {
    if (!open || !tool) return;
    try {
      const res = await fetch("/api/tools/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", toolId: tool.id, runtimes, params, dryRun: true }),
      });
      const json = (await res.json()) as { steps?: StepPreview[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? "не удалось построить команды");
        setPreview(null);
      } else {
        setError(null);
        setPreview(json.steps ?? []);
      }
    } catch {
      setError("не удалось построить команды");
    }
  }, [open, tool, runtimes, params]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const toggleRuntime = (id: string) => {
    setRuntimes((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const install = async () => {
    if (!tool) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", toolId: tool.id, runtimes, params }),
      });
      const json = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !json.jobId) {
        setError(json.error ?? "не удалось запустить установку");
      } else {
        onStarted(json.jobId);
      }
    } catch {
      setError("не удалось запустить установку");
    } finally {
      setBusy(false);
    }
  };

  if (!tool) return null;
  const hasScope = tool.paramDefs.some((p) => p.key === "scope");
  const hasStrict = tool.paramDefs.some((p) => p.key === "strict");
  const hasIndex = tool.paramDefs.some((p) => p.key === "indexWorkspaces");
  const mcpMode = tool.hasModes && params.mode === "mcp";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Установить ${tool.title}`}
      description={tool.description}
      width="max-w-2xl"
    >
      <div className="space-y-4">
        {tool.system.installed ? (
          <Notice tone="success">
            Системный пакет установлен{tool.system.version ? ` (${tool.system.version})` : ""} - будет настроена
            интеграция.
          </Notice>
        ) : tool.system.installCommand ? (
          <Notice tone="info">
            Системный пакет будет установлен: <span className="font-mono">{tool.system.installCommand.join(" ")}</span>{" "}
            (менеджер: {packageManager === "bun" ? "bun" : "npm"}).
          </Notice>
        ) : (
          <Notice tone="error">Системный пакет для этой платформы ставится вручную - см. docs/tools.md.</Notice>
        )}

        {tool.hasModes ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Режим</p>
            <Segmented
              value={params.mode}
              onChange={(mode) => setParams((p) => ({ ...p, mode }))}
              options={[
                { key: "wrap", label: "Прокси (wrap)" },
                { key: "mcp", label: "MCP" },
              ]}
              ariaLabel="режим Headroom"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
              {params.mode === "wrap"
                ? "Весь LLM-трафик рантаймов пойдёт через локальный прокси 127.0.0.1:8787 (откат - unwrap)."
                : "Только MCP-сервер headroom (compress/retrieve/stats) - трафик рантаймов не меняется."}
            </p>
          </div>
        ) : null}

        {tool.perRuntime && !mcpMode ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Рантаймы</p>
            <div className="flex flex-wrap gap-1.5">
              {tool.perRuntime.supported.map((r) => (
                <Chip
                  key={r.id}
                  tone={runtimes.includes(r.id) ? "emerald" : "dim"}
                  onClick={() => toggleRuntime(r.id)}
                  title={r.note ?? (r.installed ? "интеграция уже установлена" : undefined)}
                >
                  {runtimes.includes(r.id) ? "✓ " : ""}
                  {r.id}
                  {r.installed ? " •" : ""}
                </Chip>
              ))}
              {tool.perRuntime.unsupported.map((r) => (
                <Chip key={r.id} tone="dashed" title={r.note ?? "не поддерживается"}>
                  {r.id} ⃠
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-fg-faint">
              ✓ - выбрано (по умолчанию все поддерживаемые) · • - интеграция уже стоит
            </p>
          </div>
        ) : null}

        {tool.perRuntime && !mcpMode && (hasScope || hasStrict) ? (
          <div className="space-y-2">
            {hasScope ? (
              <div className="flex items-center gap-3">
                <span className="w-40 text-xs text-fg-muted">Область интеграции</span>
                <Select
                  value={params.scope}
                  onChange={(scope) => setParams((p) => ({ ...p, scope: scope as "global" | "project" }))}
                  options={[
                    { value: "global", label: "Глобально (~)" },
                    { value: "project", label: "В проект (repo)" },
                  ]}
                  ariaLabel="область интеграции"
                />
              </div>
            ) : null}
            {hasStrict ? (
              <div className="flex items-center gap-3">
                <Toggle
                  checked={params.strict}
                  onChange={(strict) => setParams((p) => ({ ...p, strict }))}
                  ariaLabel="strict"
                />
                <span className="text-xs text-fg-muted">Strict - блокировать первый "сырой" read сессии (Claude)</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {hasIndex ? (
          <div className="flex items-center gap-3">
            <Toggle
              checked={params.indexWorkspaces}
              onChange={(indexWorkspaces) => setParams((p) => ({ ...p, indexWorkspaces }))}
              ariaLabel="индексация рабочих папок"
            />
            <span className="text-xs text-fg-muted">Проиндексировать рабочие папки (qmd collection add)</span>
          </div>
        ) : null}

        <div>
          <p className="mb-1.5 text-xs font-medium text-fg-muted">Команды</p>
          <pre className="max-h-40 overflow-auto rounded-lg border border-line bg-page p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
            {error
              ? error
              : preview === null
                ? "…"
                : preview.length === 0
                  ? "внешних команд нет - будет зарегистрирован только MCP-сервер"
                  : preview.map((s) => `${s.label}\n  $ ${s.command.join(" ")}`).join("\n")}
          </pre>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="accent" disabled={busy || preview === null || Boolean(error)} onClick={() => void install()}>
            {busy ? "Запуск…" : "Установить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
