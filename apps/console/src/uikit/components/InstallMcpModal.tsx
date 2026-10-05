"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { McpTransport } from "@/core/types";
import { Button, IconButton, Input, Loading, Modal, Notice, Select, Textarea } from "@/uikit";

interface McpPreset {
  name: string;
  displayName: string;
  description: string;
  transport: McpTransport;
  docsUrl?: string;
}

/**
 * Модалка установки MCP: пресет-каталог (Context7, DeepWiki, WebMCP,
 * Playwright…) одним кликом + ручная форма для своего сервера.
 */
export function InstallMcpModal({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled?: () => void;
}) {
  const [presets, setPresets] = useState<McpPreset[] | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "stdio" as "stdio" | "http", command: "", args: "", env: "", url: "", headers: "" });

  useEffect(() => {
    if (!open || presets) return;
    void fetch("/api/mcp/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { presets?: McpPreset[] }) => setPresets(d.presets ?? []))
      .catch(() => setPresets([]));
  }, [open, presets]);

  const installPreset = async (preset: McpPreset) => {
    setBusyName(preset.name);
    setNotice(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: preset.name, transport: preset.transport }),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string; results?: { ok: boolean; label: string; error?: string }[] };
      const failed = result.results?.filter((r) => !r.ok) ?? [];
      setNotice(
        res.ok
          ? `${preset.displayName}: добавлен и засинкан${failed.length ? ` (ошибки: ${failed.map((f) => f.label).join(", ")})` : ""}`
          : `Ошибка: ${result.error}`,
      );
      if (res.ok) onInstalled?.();
    } finally {
      setBusyName(null);
    }
  };

  const addCustom = async () => {
    if (!form.name.trim()) {
      setNotice("задайте имя сервера");
      return;
    }
    const headerLines = form.headers
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (headerLines.some((l) => l.indexOf("=") <= 0)) {
      setNotice("headers: строки в формате KEY=value");
      return;
    }
    const httpHeaders = Object.fromEntries(
      headerLines.map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
    );
    const transport: McpTransport =
      form.type === "stdio"
        ? {
            type: "stdio",
            command: form.command.trim(),
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
        : {
            type: "http",
            url: form.url.trim(),
            ...(headerLines.length ? { headers: httpHeaders } : {}),
          };
    setBusyName("__custom");
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), transport }),
      });
      const result = (await res.json()) as { ok?: boolean; error?: string };
      setNotice(res.ok ? `Добавлен ${form.name}` : `Ошибка: ${result.error}`);
      if (res.ok) {
        setForm({ name: "", type: "stdio", command: "", args: "", env: "", url: "", headers: "" });
        setCustomOpen(false);
        onInstalled?.();
      }
    } finally {
      setBusyName(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Установить MCP-сервер" description="Пресеты устанавливаются в глобальный реестр и синкаются в файлы всех рантаймов в их форматах.">
      {notice ? <Notice tone="info" className="mb-3">{notice}</Notice> : null}

      {!presets ? (
        <Loading>загрузка каталога…</Loading>
      ) : (
        <ul className="divide-y divide-line/60">
          {presets.map((preset) => (
            <li key={preset.name} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-fg">
                  {preset.displayName}{" "}
                  <span className="font-mono text-[10px] text-fg-faint">{preset.name}</span>
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">{preset.description}</p>
                <p className="truncate font-mono text-[10px] text-fg-faint">
                  {preset.transport.type === "stdio"
                    ? `${preset.transport.command} ${(preset.transport.args ?? []).join(" ")}`
                    : preset.transport.url}
                </p>
              </div>
              {preset.docsUrl ? (
                <IconButton icon={ExternalLink} label="открыть документацию" href={preset.docsUrl} size="xs" />
              ) : null}
              <Button
                variant="primary"
                disabled={busyName === preset.name}
                onClick={() => void installPreset(preset)}
              >
                {busyName === preset.name ? "…" : "Установить"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line/60 pt-3">
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className="text-[11px] text-fg-muted underline decoration-dotted hover:text-fg"
        >
          {customOpen ? "скрыть" : "свой сервер (command/args/env или url)…"}
        </button>
        {customOpen ? (
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-6">
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
                  placeholder="env: KEY=value"
                  rows={2}
                  className="md:col-span-4"
                />
              </>
            ) : (
              <>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://…/mcp"
                  className="md:col-span-4"
                />
                <Textarea
                  value={form.headers}
                  onChange={(e) => setForm({ ...form, headers: e.target.value })}
                  placeholder="headers: KEY=value, по одному в строке (опционально)"
                  rows={2}
                  className="md:col-span-4"
                />
              </>
            )}
            <Button
              variant="primary"
              size="md"
              disabled={busyName === "__custom"}
              onClick={() => void addCustom()}
            >
              Добавить
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
