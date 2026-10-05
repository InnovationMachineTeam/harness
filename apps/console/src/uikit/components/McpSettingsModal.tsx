"use client";

import { useEffect, useState } from "react";
import type { McpServerDef, McpTransport, TargetSyncResult } from "@/core/types";
import { Button, Input, Modal, Notice, Select, Textarea } from "@/uikit";

/** "KEY=value" построчно → Record; ok: false - строка без "=" или с пустым ключом. */
function parseKeyValue(text: string): { ok: true; value: Record<string, string> } | { ok: false } {
  const value: Record<string, string> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf("=");
    if (i <= 0) return { ok: false };
    value[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { ok: true, value };
}

/**
 * Настройки MCP-сервера: редактирование транспорта (stdio: command/args/env,
 * http: url/headers) существующей записи реестра. Сохранение - PATCH /api/mcp
 * с последующим синком; enabled и runtimeOverrides не изменяются.
 */
export function McpSettingsModal({
  server,
  open,
  onClose,
  onSaved,
}: {
  server: McpServerDef | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (name: string, results: TargetSyncResult[]) => void;
}) {
  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !server) return;
    setNotice(null);
    const t = server.transport;
    setType(t.type);
    if (t.type === "stdio") {
      setCommand(t.command);
      setArgs((t.args ?? []).join(" "));
      setEnv(Object.entries(t.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    } else {
      setUrl(t.url);
      setHeaders(Object.entries(t.headers ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    }
  }, [open, server]);

  if (!server) return null;

  const save = async () => {
    let transport: McpTransport;
    if (type === "stdio") {
      if (!command.trim()) {
        setNotice("задайте command");
        return;
      }
      const parsedEnv = parseKeyValue(env);
      if (!parsedEnv.ok) {
        setNotice("env: строки в формате KEY=value");
        return;
      }
      transport = {
        type: "stdio",
        command: command.trim(),
        ...(args.trim() ? { args: args.split(/\s+/).filter(Boolean) } : {}),
        ...(Object.keys(parsedEnv.value).length ? { env: parsedEnv.value } : {}),
      };
    } else {
      if (!/^https?:\/\//.test(url.trim())) {
        setNotice("url должен начинаться с http:// или https://");
        return;
      }
      const parsedHeaders = parseKeyValue(headers);
      if (!parsedHeaders.ok) {
        setNotice("headers: строки в формате KEY=value");
        return;
      }
      transport = {
        type: "http",
        url: url.trim(),
        ...(Object.keys(parsedHeaders.value).length ? { headers: parsedHeaders.value } : {}),
      };
    }

    setBusy(true);
    try {
      const res = await fetch("/api/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: server.name, transport }),
      });
      const result = (await res.json()) as { error?: string; results?: TargetSyncResult[] };
      if (!res.ok) {
        setNotice(`Ошибка: ${result.error}`);
        return;
      }
      onSaved?.(server.name, result.results ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Настройки · ${server.name}`}
      description="Изменения применяются к реестру и сразу синкаются в файлы рантаймов. Глобальный toggle и override-чипы настраиваются на карточке сервера."
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" size="md" disabled={busy} onClick={() => void save()}>
            {busy ? "…" : "Сохранить и синк"}
          </Button>
        </>
      }
    >
      {notice ? (
        <Notice tone="error" className="mb-3">
          {notice}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-2">
        <Select
          value={type}
          onChange={(value) => setType(value as "stdio" | "http")}
          size="md"
          options={[
            { value: "stdio", label: "stdio" },
            { value: "http", label: "http" },
          ]}
          ariaLabel="тип транспорта"
        />
        {type === "stdio" ? (
          <>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="command (npx …)"
              aria-label="command"
            />
            <Input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="args через пробел"
              aria-label="args"
            />
            <Textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder="env: KEY=value, по одному в строке"
              aria-label="env"
              rows={3}
            />
          </>
        ) : (
          <>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/mcp"
              aria-label="url"
            />
            <Textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder="headers: KEY=value, по одному в строке"
              aria-label="headers"
              rows={3}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
