"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { McpServerDef, SkillItem } from "@/core/types";
import type { McpLabel } from "@/core/mcpLabels";
import { useConsoleStore } from "@/store/console";
import { Info } from "lucide-react";
import { Button, Chip, IconButton, Loading, Panel, Tabs, Toggle } from "@/uikit";
import { UnifiedSkillsList } from "@/uikit/components/skills/UnifiedSkillsList";
import { LifecycleInfoModal, mcpLifecycleInfo } from "@/uikit/components/common/LifecycleInfoModal";

interface SkillRow extends SkillItem {
  runtimeOverride: boolean | null;
  effective: boolean;
}

interface SkillsData {
  supported: boolean;
  useGlobal: boolean;
  items: SkillRow[];
}

interface McpData {
  servers: Array<McpServerDef & { label?: McpLabel }>;
}

type SubTab = "skills" | "scripts" | "mcp";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "skills", label: "Навыки" },
  { key: "scripts", label: "Скрипты" },
  { key: "mcp", label: "MCP" },
];

const KIND_LABELS: Record<SkillItem["kind"], string> = {
  skill: "навык",
  plugin: "плагин",
  agent: "агент",
  script: "скрипт",
};

/**
 * Вкладка навыков пространства рантайма. Саб-таб "Навыки" - единый список
 * всех источников (internal/runtime/skills.sh/plugin/workflow) с лейблами и
 * бейджами рантаймов; тоггл строки - override данного рантайма, переключение
 * выполняет хуки (симлинки в обязательной папке + команды манифеста).
 * "Скрипты" - не-навыки (промпты codex, агенты и плагины opencode). MCP -
 * пользовательские override серверов (синк в конфиг рантайма).
 */
export function SkillsPanel({ runtime }: { runtime: string }) {
  const [subTab, setSubTab] = useState<SubTab>("skills");
  const [data, setData] = useState<SkillsData | null>(null);
  const [mcp, setMcp] = useState<McpData | null>(null);
  const useGlobal = useConsoleStore((s) => s.useGlobalSkills);
  const fetchTabData = useConsoleStore((s) => s.fetchTabData);
  const invalidateTab = useConsoleStore((s) => s.invalidateTab);

  const load = useCallback(async () => {
    // скрипты кешируются в store - повторное открытие вкладки мгновенно
    const [s, m] = await Promise.all([
      fetchTabData<SkillsData>(`skills:${runtime}`, `/api/skills?runtime=${runtime}`, 15_000),
      fetch("/api/mcp", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ]);
    if (s) setData(s);
    if (m?.servers) setMcp(m);
  }, [fetchTabData, runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const invalidateSkillsTabs = () => {
    invalidateTab("skills:");
  };

  const toggleMcp = async (server: McpServerDef, value: boolean) => {
    await fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: server.name, runtimeOverride: { runtime, value } }),
    });
    await load();
  };

  const resetMcpOverride = async (server: McpServerDef) => {
    await fetch("/api/mcp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: server.name, runtimeOverride: { runtime, value: null } }),
    });
    await load();
  };

  const scripts = (data?.items ?? []).filter((i) => i.origin === "runtime" && (i.kind === "script" || i.kind === "agent" || i.kind === "plugin"));

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-line/60 pb-2">
        <Tabs tabs={SUB_TABS} active={subTab} onChange={setSubTab} size="sm" />
        <span className="ml-auto text-[11px] text-fg-faint">
          глобальные навыки: {useGlobal === null ? "…" : useGlobal ? "используются" : "отключены"}{" "}
          (<Link href="/settings?tab=skills" className="underline decoration-dotted hover:text-fg-muted">toggle</Link>)
        </span>
      </div>

      {subTab === "skills" ? (
        <UnifiedSkillsList mode="runtime" runtimeId={runtime} />
      ) : subTab === "mcp" ? (
        <McpSubTab mcp={mcp} runtime={runtime} onToggle={toggleMcp} onReset={resetMcpOverride} />
      ) : (
        <SkillList
          items={scripts}
          empty="Скрипты/агенты этого рантайма не обнаружены."
          loading={data === null}
          runtime={runtime}
          useGlobal={useGlobal ?? true}
          onInvalidate={invalidateSkillsTabs}
        />
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-fg-faint">
        Тогглы навыков - настройки консоли (override уровня рантайма поверх значения по умолчанию); включение и
        выключение выполняет хуки навыка: симлинк в обязательной рабочей папке (write mode) и команды манифеста.
        MCP-тогглы синкают пользовательский конфиг этого рантайма.
      </p>
    </Panel>
  );
}

/** Скрипты/агенты/плагины рантайма: read-only дискавери с тогглом override. */
function SkillList({
  items,
  empty,
  loading,
  runtime,
  useGlobal,
  onInvalidate,
}: {
  items: SkillRow[];
  empty: string;
  loading: boolean;
  runtime: string;
  useGlobal: boolean;
  onInvalidate: () => void;
}) {
  if (loading) return <Loading />;
  if (items.length === 0) return <p className="text-xs text-fg-faint">{empty}</p>;
  const toggle = async (item: SkillRow, enabled: boolean) => {
    await fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, level: "runtime", runtime, enabled }),
    });
    onInvalidate();
  };
  const resetOverride = async (item: SkillRow) => {
    await fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, level: "runtime", runtime, enabled: useGlobal }),
    });
    onInvalidate();
  };
  return (
    <ul className="divide-y divide-line/50">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg">
              {item.name}{" "}
              <Chip tone="solid">{KIND_LABELS[item.kind]}</Chip>
              {item.runtimeOverride !== null ? <span className="ml-1 text-[10px] text-warning">override</span> : null}
            </p>
            {item.description ? (
              <p className="mt-0.5 truncate text-[11px] text-fg-faint" title={item.description}>
                {item.description}
              </p>
            ) : null}
            <p className="truncate font-mono text-[10px] text-fg-faint" title={item.source}>
              {item.source}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {item.runtimeOverride !== null ? (
              <Button
                variant="ghostDim"
                size="xs"
                title="Снять override: вернуть глобальную настройку"
                onClick={() => void resetOverride(item)}
              >
                сброс
              </Button>
            ) : null}
            <Toggle
              checked={item.effective}
              onChange={(value) => void toggle(item, value)}
              ariaLabel={`скрипт ${item.name}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const MCP_LABEL_FILTERS: Array<{ key: McpLabel | "all"; label: string }> = [
  { key: "all", label: "Все" },
  { key: "preset", label: "preset" },
  { key: "plugin", label: "plugin" },
  { key: "tool", label: "tool" },
  { key: "manual", label: "manual" },
];

const MCP_LABEL_TONE: Record<McpLabel, "neutral" | "amber" | "emerald" | "sky"> = {
  preset: "neutral",
  plugin: "amber",
  tool: "emerald",
  manual: "sky",
};

function McpSubTab({
  mcp,
  runtime,
  onToggle,
  onReset,
}: {
  mcp: McpData | null;
  runtime: string;
  onToggle: (server: McpServerDef, value: boolean) => Promise<void>;
  onReset: (server: McpServerDef) => Promise<void>;
}) {
  const [filter, setFilter] = useState<McpLabel | "all">("all");
  const [infoServer, setInfoServer] = useState<(McpServerDef & { label?: McpLabel }) | null>(null);
  if (mcp === null) return <Loading />;
  if (mcp.servers.length === 0) {
    return (
      <p className="text-xs text-fg-faint">
        Реестр MCP пуст - добавьте серверы в{" "}
        <Link href="/settings?tab=mcp" className="underline decoration-dotted hover:text-fg-muted">
          Настройках (MCP)
        </Link>
        .
      </p>
    );
  }
  const servers = mcp.servers.filter((server) => filter === "all" || (server.label ?? "manual") === filter);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="фильтр MCP по лейблу">
        {MCP_LABEL_FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${filter === entry.key ? "border-info bg-info/10 text-info" : "border-line text-fg-faint hover:text-fg"}`}
          >
            {entry.label}{" "}
            <span className="opacity-60">
              {entry.key === "all"
                ? mcp.servers.length
                : mcp.servers.filter((server) => (server.label ?? "manual") === entry.key).length}
            </span>
          </button>
        ))}
      </div>
      {servers.length === 0 ? (
        <p className="text-xs text-fg-faint">Нет серверов с таким лейблом.</p>
      ) : (
      <ul className="divide-y divide-line/50">
      {servers.map((server) => {
        const override = server.runtimeOverrides?.[runtime];
        const effective = override ?? server.enabled;
        return (
          <li key={server.name} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg">
                <span className="font-mono">{server.name}</span>{" "}
                <Chip tone={MCP_LABEL_TONE[server.label ?? "manual"]} mono title="происхождение сервера">{server.label ?? "manual"}</Chip>
                {override !== undefined ? <span className="ml-1 text-[10px] text-warning">override</span> : null}
                <IconButton
                  icon={Info}
                  label={`жизненный цикл: ${server.name}`}
                  variant="ghost"
                  size="xs"
                  onClick={() => setInfoServer(server)}
                />
              </p>
              <p className="truncate text-[11px] text-fg-faint">
                {server.transport.type === "stdio"
                  ? `stdio · ${server.transport.command} ${(server.transport.args ?? []).join(" ")}`
                  : `http · ${server.transport.url}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {override !== undefined ? (
                <Button
                  variant="ghostDim"
                  size="xs"
                  title="Снять override: вернуть глобальную настройку"
                  onClick={() => void onReset(server)}
                >
                  сброс
                </Button>
              ) : null}
              <Toggle
                checked={effective}
                onChange={(value) => void onToggle(server, value)}
                ariaLabel={`MCP ${server.name}`}
              />
            </div>
          </li>
        );
      })}
      </ul>
      )}
      <LifecycleInfoModal
        open={infoServer !== null}
        onClose={() => setInfoServer(null)}
        info={mcpLifecycleInfo({ name: infoServer?.name ?? "", hooks: infoServer?.hooks })}
      />
    </div>
  );
}
