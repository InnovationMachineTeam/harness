"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { McpServerDef, SkillItem } from "@/core/types";
import { useConsoleStore } from "@/store/console";
import { Button, Chip, Loading, Panel, Tabs, Toggle } from "@/ui/UIKit";

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
  servers: McpServerDef[];
}

type SubTab = "runtime" | "harness" | "scripts" | "mcp";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "runtime", label: "Runtime Skills" },
  { key: "harness", label: "Harness Skills" },
  { key: "scripts", label: "Scripts" },
  { key: "mcp", label: "MCP" },
];

const KIND_LABELS: Record<SkillItem["kind"], string> = {
  skill: "навык",
  plugin: "плагин",
  agent: "агент",
  script: "скрипт",
};

/**
 * Вкладка навыков пространства рантайма: Runtime Skills (собственные каталоги),
 * Harness Skills (.agents/skills), Scripts (агенты/плагины/промпты), MCP
 * (пользовательские override серверов). Тогглы - оверлей консоли; файлы не
 * изменяются. MCP-override синкается в конфиг рантайма.
 */
export function SkillsPanel({ runtime }: { runtime: string }) {
  const [subTab, setSubTab] = useState<SubTab>("runtime");
  const [data, setData] = useState<SkillsData | null>(null);
  const [mcp, setMcp] = useState<McpData | null>(null);
  const useGlobal = useConsoleStore((s) => s.useGlobalSkills);
  const fetchTabData = useConsoleStore((s) => s.fetchTabData);
  const invalidateTab = useConsoleStore((s) => s.invalidateTab);

  const load = useCallback(async () => {
    // список навыков кешируется в store - повторное открытие вкладки мгновенно
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

  const toggleSkill = async (item: SkillRow, enabled: boolean) => {
    await fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, level: "runtime", runtime, enabled }),
    });
    invalidateTab(`skills:`);
    await load();
  };

  const resetOverride = async (item: SkillRow) => {
    await fetch("/api/skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, level: "runtime", runtime, enabled: data?.useGlobal ?? true }),
    });
    invalidateTab(`skills:`);
    await load();
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

  const items = data?.items ?? [];
  const runtimeSkills = items.filter((i) => i.origin === "runtime" && i.kind === "skill");
  const harnessSkills = items.filter((i) => i.origin === "harness");
  const scripts = items.filter((i) => i.origin === "runtime" && (i.kind === "script" || i.kind === "agent" || i.kind === "plugin"));

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-line/60 pb-2">
        <Tabs tabs={SUB_TABS} active={subTab} onChange={setSubTab} size="sm" />
        <span className="ml-auto text-[11px] text-fg-faint">
          глобальные навыки: {useGlobal === null ? "…" : useGlobal ? "используются" : "отключены"}{" "}
          (<Link href="/skills" className="underline decoration-dotted hover:text-fg-muted">toggle</Link>)
        </span>
      </div>

      {subTab === "mcp" ? (
        <McpSubTab mcp={mcp} runtime={runtime} onToggle={toggleMcp} onReset={resetMcpOverride} />
      ) : (
        <SkillList
          items={
            subTab === "runtime" ? runtimeSkills : subTab === "harness" ? harnessSkills : scripts
          }
          empty={
            subTab === "harness"
              ? "Harness-навыки не найдены: ожидается .agents/skills/<name>/SKILL.md в репозитории (каталог пока не создан)."
              : subTab === "scripts"
                ? "Скрипты/агенты этого рантайма не обнаружены."
                : data && !data.supported
                  ? "Каталоги навыков этого рантайма не обнаружены (или задаются через его настройки, например extra_skill_dirs у Kimi)."
                  : "Навыков не найдено."
          }
          loading={data === null}
          onToggle={toggleSkill}
          onReset={resetOverride}
        />
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-fg-faint">
        Тогглы навыков - настройки консоли (override уровня рантайма поверх глобального toggle); файлы рантайма не
        изменяются. MCP-тогглы синкают пользовательский конфиг этого рантайма (проектный .mcp.json управляется
        глобально на странице "Навыки и MCP").
      </p>
    </Panel>
  );
}

function SkillList({
  items,
  empty,
  loading,
  onToggle,
  onReset,
}: {
  items: SkillRow[];
  empty: string;
  loading: boolean;
  onToggle: (item: SkillRow, enabled: boolean) => Promise<void>;
  onReset: (item: SkillRow) => Promise<void>;
}) {
  if (loading) return <Loading />;
  if (items.length === 0) return <p className="text-xs text-fg-faint">{empty}</p>;
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
                onClick={() => void onReset(item)}
              >
                сброс
              </Button>
            ) : null}
            <Toggle
              checked={item.effective}
              onChange={(value) => void onToggle(item, value)}
              ariaLabel={`навык ${item.name}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

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
  if (mcp === null) return <Loading />;
  if (mcp.servers.length === 0) {
    return (
      <p className="text-xs text-fg-faint">
        Реестр MCP пуст - добавьте серверы на странице{" "}
        <Link href="/manage" className="underline decoration-dotted hover:text-fg-muted">
          "Навыки и MCP"
        </Link>
        .
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line/50">
      {mcp.servers.map((server) => {
        const override = server.runtimeOverrides?.[runtime];
        const effective = override ?? server.enabled;
        return (
          <li key={server.name} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg">
                <span className="font-mono">{server.name}</span>
                {override !== undefined ? <span className="ml-1 text-[10px] text-warning">override</span> : null}
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
  );
}
