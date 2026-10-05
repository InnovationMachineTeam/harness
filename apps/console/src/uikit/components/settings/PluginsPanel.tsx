"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Button, confirmDialog, IconButton, Input, Loading, Notice, Panel, Toggle } from "@/uikit";
import { LifecycleInfoModal, pluginLifecycleInfo } from "@/uikit/components/common/LifecycleInfoModal";

interface PluginMcpContribution {
  name: string;
  transport: { type: string; command?: string; args?: string[]; url?: string };
}

interface PluginDef {
  id: string;
  displayName: string;
  description?: string;
  mcp: PluginMcpContribution[];
  skills?: { name: string; description?: string }[];
  source: string;
  url?: string;
  enabled?: boolean;
  hooks?: { install?: string[]; remove?: string[]; enable?: string[]; disable?: string[] };
}

interface Catalog {
  name: string;
  url: string | null;
  plugins: PluginDef[];
  error?: string;
}

interface PluginsData {
  installed: PluginDef[];
  marketplaces: { name: string; url: string }[];
  catalogs: Catalog[];
}

/** Вкладка "Плагины" (Настройки): бандлы MCP-серверов, marketplace-каталоги. */
export function PluginsPanel() {
  const [data, setData] = useState<PluginsData | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [marketplaceForm, setMarketplaceForm] = useState({ name: "", url: "" });
  const [infoPlugin, setInfoPlugin] = useState<PluginDef | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/plugins", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as PluginsData);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<Response>, okText: (d: Record<string, unknown>) => string) => {
    setNotice(null);
    try {
      const res = await fn();
      const result = (await res.json()) as Record<string, unknown>;
      setNotice({ ok: res.ok, text: res.ok ? okText(result) : String(result.error ?? "ошибка") });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const install = (plugin: PluginDef) =>
    act(
      () =>
        fetch("/api/plugins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plugin: { id: plugin.id } }),
        }),
      () => `плагин ${plugin.displayName} установлен и включён (MCP добавлены в реестр)`,
    );

  const toggle = (plugin: PluginDef) =>
    act(
      () =>
        fetch("/api/plugins", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: plugin.id, enabled: !plugin.enabled }),
        }),
      () => `плагин ${plugin.displayName}: ${plugin.enabled ? "выключен (MCP убраны)" : "включён (MCP добавлены)"}`,
    );

  const uninstall = async (plugin: PluginDef) => {
    if (
      !(await confirmDialog({
        title: `Удалить плагин "${plugin.displayName}"?`,
        message: `Перед удалением выполнится hook remove (если объявлен). Плагин выключается и запись удаляется; его MCP-серверы (${plugin.mcp.map((m) => m.name).join(", ") || "нет"}) будут убраны из реестра и файлов рантаймов (защита: серверы с изменённым пользователем транспортом не трогаются). Действие необратимо.`,
        confirmLabel: "Удалить",
        tone: "danger",
      }))
    ) {
      return;
    }
    await act(
      () => fetch(`/api/plugins?id=${encodeURIComponent(plugin.id)}`, { method: "DELETE" }),
      () => `плагин ${plugin.displayName} удалён`,
    );
  };

  const addMarketplace = () =>
    act(
      () =>
        fetch("/api/plugins/marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(marketplaceForm),
        }),
      () => `marketplace "${marketplaceForm.name}" добавлен`,
    );

  const removeMarketplace = (name: string) =>
    act(
      () => fetch(`/api/plugins/marketplace?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
      () => `marketplace "${name}" удалён`,
    );

  const installedIds = new Set((data?.installed ?? []).map((p) => p.id));

  return (
    <>
      {notice ? (
        <Notice tone={notice.ok ? "success" : "error"} className="mb-4">{notice.text}</Notice>
      ) : null}

      {/* Установленные */}
      <Panel className="mb-6" title="Установленные плагины">
        {!data ? (
          <Loading />
        ) : data.installed.length === 0 ? (
          <p className="text-xs text-fg-faint">Пока пусто - установите из каталога ниже.</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {data.installed.map((plugin) => (
              <li key={plugin.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-fg">
                    {plugin.displayName}{" "}
                    <span className="ml-1 rounded bg-raised px-1.5 py-0.5 text-[10px] text-fg-muted">
                      MCP: {plugin.mcp.map((m) => m.name).join(", ") || "-"}
                    </span>
                  </p>
                  {plugin.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-faint" title={plugin.description}>
                      {plugin.description}
                    </p>
                  ) : null}
                  {plugin.url ? (
                    <a
                      href={plugin.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-mono text-[10px] text-info underline decoration-dotted"
                    >
                      {plugin.url}
                    </a>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <IconButton
                    icon={Info}
                    label={`жизненный цикл: ${plugin.displayName}`}
                    variant="ghost"
                    size="xs"
                    onClick={() => setInfoPlugin(plugin)}
                  />
                  <Toggle
                    checked={Boolean(plugin.enabled)}
                    disabled={busyId === plugin.id}
                    onChange={() => void toggle(plugin)}
                    title={plugin.enabled ? "Выключить: MCP убираются из реестра" : "Включить: MCP добавляются в реестр"}
                    ariaLabel={`плагин ${plugin.displayName}`}
                  />
                  <Button
                    variant="danger"
                    size="xs"
                    disabled={busyId === plugin.id}
                    onClick={() => void uninstall(plugin)}
                  >
                    удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Marketplace-каталоги */}
      <Panel title="Marketplace">
        <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
          Каталог - JSON-манифест по https-URL: <span className="font-mono">{'{ "plugins": [{ id, displayName, description, mcp: [{ name, transport: {type, command, args?} | {type:"http", url} }] }] }'}</span>.
          Формат манифеста валидируется на сервере; частные адреса запрещены.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <Input
            value={marketplaceForm.name}
            onChange={(e) => setMarketplaceForm({ ...marketplaceForm, name: e.target.value })}
            placeholder="имя (например: team)"
            className="w-40"
          />
          <Input
            value={marketplaceForm.url}
            onChange={(e) => setMarketplaceForm({ ...marketplaceForm, url: e.target.value })}
            placeholder="https://example.com/plugins.json"
            className="min-w-64 flex-1 font-mono"
          />
          <Button variant="neutral" size="md" onClick={() => void addMarketplace()}>
            Добавить
          </Button>
        </div>

        {!data ? (
          <Loading />
        ) : (
          <div className="space-y-4">
            {data.catalogs.map((catalog) => (
              <div key={catalog.name}>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="font-mono text-[11px] uppercase tracking-wide text-fg-faint">
                    {catalog.name}
                    {catalog.url ? ` · ${catalog.url}` : " · встроенный"}
                  </h3>
                  {catalog.url ? (
                    <Button
                      variant="ghostDim"
                      size="xs"
                      className="ml-auto"
                      onClick={() => void removeMarketplace(catalog.name)}
                    >
                      убрать
                    </Button>
                  ) : null}
                </div>
                {catalog.error ? (
                  <p className="text-[11px] text-danger">ошибка загрузки: {catalog.error}</p>
                ) : (
                  <ul className="divide-y divide-line/50">
                    {catalog.plugins.map((plugin) => {
                      const installed = installedIds.has(plugin.id);
                      return (
                        <li key={plugin.id} className="flex items-center gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-fg">{plugin.displayName}</p>
                            {plugin.description ? (
                              <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-faint" title={plugin.description}>
                                {plugin.description}
                              </p>
                            ) : null}
                            <p className="truncate font-mono text-[10px] text-fg-faint">
                              MCP: {plugin.mcp.map((m) => m.name).join(", ") || "-"}
                              {plugin.skills?.length ? ` · навыки: ${plugin.skills.map((s) => s.name).join(", ")}` : ""}
                            </p>
                          </div>
                          {installed ? (
                            <span className="shrink-0 text-[11px] text-accent">установлен</span>
                          ) : (
                            <Button
                              variant="primary"
                              disabled={busyId === plugin.id}
                              onClick={() =>
                                void confirmDialog({
                                  title: `Установить плагин "${plugin.displayName}"?`,
                                  message: `Плагин будет установлен и включён. Его MCP-серверы (${plugin.mcp.map((m) => m.name).join(", ") || "нет"}) войдут в общий реестр и синхронизируются в файлы рантаймов. Выполнится hook install, если он объявлен.`,
                                  confirmLabel: "Установить",
                                }).then((ok) => {
                                  if (ok) void install(plugin);
                                })
                              }
                            >
                              Установить
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <LifecycleInfoModal
        open={infoPlugin !== null}
        onClose={() => setInfoPlugin(null)}
        info={pluginLifecycleInfo({ displayName: infoPlugin?.displayName ?? "", mcp: (infoPlugin?.mcp ?? []).map((m) => m.name), hooks: infoPlugin?.hooks })}
      />
    </>
  );
}
