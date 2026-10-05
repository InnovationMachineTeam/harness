"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Info, Settings, X } from "lucide-react";
import type { McpServerDef, TargetSyncResult } from "@/core/types";
import type { McpLabel } from "@/core/mcpLabels";
import { McpSettingsModal } from "@/uikit/components/McpSettingsModal";
import { LifecycleInfoModal, mcpLifecycleInfo } from "@/uikit/components/common/LifecycleInfoModal";
import { Button, Chip, confirmDialog, IconButton, Input, Loading, Notice, Panel, Select, Textarea } from "@/uikit";

interface McpData {
  servers: Array<McpServerDef & { label?: McpLabel }>;
  targets: TargetSyncResult[];
}

const RUNTIMES = ["claude", "codex", "zcode", "cursor", "kimi", "opencode"];

const LABEL_FILTERS: Array<{ key: McpLabel | "all"; label: string }> = [
  { key: "all", label: "Все" },
  { key: "preset", label: "preset" },
  { key: "plugin", label: "plugin" },
  { key: "tool", label: "tool" },
  { key: "manual", label: "manual" },
];

const LABEL_TONE: Record<McpLabel, "neutral" | "amber" | "emerald" | "sky"> = {
  preset: "neutral",
  plugin: "amber",
  tool: "emerald",
  manual: "sky",
};

/** Управление глобальным реестром MCP + синк в файлы рантаймов. */
export function McpPanel() {
  const [data, setData] = useState<McpData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "stdio" as "stdio" | "http", command: "", args: "", env: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<McpServerDef | null>(null);
  const [filter, setFilter] = useState<McpLabel | "all">("all");
  const [infoServer, setInfoServer] = useState<(McpServerDef & { label?: McpLabel }) | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/mcp", { cache: "no-store" });
    setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const servers = useMemo(() => (data?.servers ?? []).filter((server) => filter === "all" || server.label === filter), [data, filter]);
  const counts = useMemo(() => {
    const map = new Map<McpLabel | "all", number>([["all", data?.servers.length ?? 0]]);
    for (const server of data?.servers ?? []) map.set(server.label ?? "manual", (map.get(server.label ?? "manual") ?? 0) + 1);
    return map;
  }, [data]);

  const summarize = (results: TargetSyncResult[]) => {
    const okCount = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    return `синк: ${okCount}/${results.length} таргетов ок${failed.length > 0 ? `; ошибки: ${failed.map((f) => `${f.label} (${f.error})`).join("; ")}` : ""}`;
  };

  const add = async () => {
    if (!form.name.trim()) {
      setNotice("задайте имя сервера");
      return;
    }
    const transport =
      form.type === "stdio"
        ? {
            type: "stdio" as const,
            command: form.command,
            ...(form.args.trim() ? { args: form.args.split(/\s+/).filter(Boolean) } : {}),
            ...(form.env.trim()
              ? {
                  env: Object.fromEntries(
                    form.env
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .map((l) => {
                        const i = l.indexOf("=");
                        return [l.slice(0, i), l.slice(i + 1)];
                      }),
                  ),
                }
              : {}),
          }
        : { type: "http" as const, url: form.url };
    if (
      !(await confirmDialog({
        title: `Добавить MCP-сервер "${form.name.trim()}"?`,
        message: "Сервер войдёт в глобальный реестр включённым и будет синхронизирован: запись появится в проектном .mcp.json и пользовательских конфигах рантаймов (claude, codex, cursor, opencode). Выполнится hook install, если он объявлен у сервера.",
        confirmLabel: "Добавить и синк",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), transport }),
      });
      const result = await res.json();
      setNotice(res.ok ? `Добавлен ${form.name}. ${summarize(result.results)}` : `Ошибка: ${result.error}`);
      if (res.ok) setForm({ name: "", type: "stdio", command: "", args: "", env: "", url: "" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const patch = async (name: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...body }),
      });
      const result = await res.json();
      setNotice(res.ok ? `${name}: ${summarize(result.results)}` : `Ошибка: ${result.error}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (
      !(await confirmDialog({
        title: `Удалить ${name}?`,
        message: "Сервер будет удалён из реестра и всех файлов рантаймов.",
        confirmLabel: "Удалить",
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/mcp?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const result = await res.json();
      setNotice(res.ok ? `Удалён ${name}. ${summarize(result.results)}` : `Ошибка: ${result.error}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="MCP-серверы (глобально)">
      <p className="mb-4 text-[11px] leading-relaxed text-fg-faint">
        Синк: проектный <span className="font-mono">.mcp.json</span> - по глобальному toggle; пользовательские
        конфиги рантаймов - с учётом override. Отключение удаляет сервер из файлов, но сохраняет в реестре.
        ZCode и Kimi глобального MCP-формата не имеют - для них работает только проектный .mcp.json.
      </p>

      {notice ? <Notice tone="info" className="mb-3">{notice}</Notice> : null}

      <div className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line bg-page/40 p-3 md:grid-cols-6">
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="имя (lat-символы)"
        />
        <Select
          value={form.type}
          onChange={(value) => setForm({ ...form, type: value as "stdio" | "http" })}
          size="md"
          options={[
            { value: "stdio", label: "stdio" },
            { value: "http", label: "http" },
          ]}
          ariaLabel="тип транспорта"
        />
        {form.type === "stdio" ? (
          <>
            <Input
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="command (npx …)"
              className="md:col-span-2"
            />
            <Input
              value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
              placeholder="args через пробел"
              className="md:col-span-2"
            />
            <Textarea
              value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
              placeholder="env: KEY=value, по одному в строке"
              rows={2}
              className="md:col-span-4"
            />
          </>
        ) : (
          <Input
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://…/mcp"
            className="md:col-span-4"
          />
        )}
        <Button variant="primary" size="md" disabled={busy} onClick={() => void add()}>
          Добавить и синк
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="фильтр MCP по лейблу">
        {LABEL_FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${filter === entry.key ? "border-info bg-info/10 text-info" : "border-line text-fg-faint hover:text-fg"}`}
          >
            {entry.label} <span className="opacity-60">{counts.get(entry.key) ?? 0}</span>
          </button>
        ))}
      </div>

      {!data ? (
        <Loading />
      ) : servers.length === 0 ? (
        <p className="text-xs text-fg-faint">{data.servers.length ? "Нет серверов с таким лейблом." : "Реестр пуст."}</p>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => {
            const overrideOf = (runtime: string) => server.runtimeOverrides?.[runtime];
            return (
              <article key={server.name} className="rounded-lg border border-line bg-page/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-fg">{server.name}</span>
                  <Chip tone={LABEL_TONE[server.label ?? "manual"]} mono title="происхождение сервера">{server.label ?? "manual"}</Chip>
                  <span className="text-[11px] text-fg-faint">
                    {server.transport.type === "stdio"
                      ? `stdio · ${server.transport.command} ${(server.transport.args ?? []).join(" ")}`
                      : `http · ${server.transport.url}`}
                  </span>
                  <Button
                    variant={server.enabled ? "primary" : "ghostDim"}
                    size="xs"
                    className="ml-auto"
                    onClick={() => void patch(server.name, { enabled: !server.enabled })}
                  >
                    глобально: {server.enabled ? "вкл" : "выкл"}
                  </Button>
                  <IconButton
                    icon={Info}
                    label={`жизненный цикл: ${server.name}`}
                    variant="ghost"
                    size="xs"
                    onClick={() => setInfoServer(server)}
                  />
                  <IconButton
                    icon={Settings}
                    label={`настройки ${server.name}`}
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditing(server)}
                  />
                  <Button variant="danger" size="xs" onClick={() => void remove(server.name)}>
                    удалить
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {RUNTIMES.map((runtime) => {
                    const ov = overrideOf(runtime);
                    const effective = ov ?? server.enabled;
                    return (
                      <Chip
                        key={runtime}
                        mono
                        title={`override ${runtime}${ov !== undefined ? ` (${ov ? "вкл" : "выкл"})` : " не задан - действует глобальный"}`}
                        onClick={() =>
                          void patch(server.name, {
                            runtimeOverride: { runtime, value: ov === undefined ? !server.enabled : !ov },
                          })
                        }
                        tone={!effective ? "dim" : ov !== undefined ? "amber" : "neutral"}
                      >
                        {runtime}
                        {ov !== undefined ? "*" : ""}
                      </Chip>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data?.targets?.length ? (
        <div className="mt-4 border-t border-line/60 pt-3">
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">Последний синк</h3>
          <ul className="space-y-1 text-[11px]">
            {data.targets.map((t) => (
              <li key={t.target} className="flex flex-wrap items-center gap-2">
                <span className={t.ok ? "text-accent" : "text-danger"}>
                  {t.ok ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
                </span>
                <span className="text-fg-muted">{t.label}</span>
                {t.applied.length > 0 ? <span className="text-fg-faint">+{t.applied.join(", ")}</span> : null}
                {t.removed.length > 0 ? <span className="text-fg-faint">−{t.removed.join(", ")}</span> : null}
                {t.error ? <span className="text-danger">{t.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <LifecycleInfoModal
        open={infoServer !== null}
        onClose={() => setInfoServer(null)}
        info={mcpLifecycleInfo({ name: infoServer?.name ?? "", hooks: infoServer?.hooks })}
      />
      <McpSettingsModal
        server={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(name, results) => {
          setEditing(null);
          setNotice(`${name}: transport обновлён. ${summarize(results)}`);
        }}
      />
    </Panel>
  );
}
