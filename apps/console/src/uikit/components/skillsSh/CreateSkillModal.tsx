"use client";

import { useState } from "react";
import { useConsoleStore } from "@/store/console";
import { Button, Input, Modal, Textarea } from "@/uikit";

/**
 * Модалка создания навыка: форма вопросов → промпт собирается на сервере →
 * запуск в новой headless-сессии рантайма задачи "Создание навыка".
 */
export function CreateSkillModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const taskRuntimes = useConsoleStore((s) => s.taskRuntimes);
  const defaultRuntime = useConsoleStore((s) => s.defaultRuntime);
  const [form, setForm] = useState({ name: "", summary: "", details: "", examples: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const runtime = taskRuntimes?.skillCreation ?? defaultRuntime ?? null;

  const submit = async () => {
    if (!form.name.trim() || !form.summary.trim()) {
      setNotice({ ok: false, text: "нужны минимум название и краткое описание" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/skills/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: form }),
      });
      const result = (await res.json()) as { ok?: boolean; detail?: string; error?: string; logFile?: string };
      setNotice({
        ok: Boolean(result.ok),
        text: result.ok
          ? `${result.detail}${result.logFile ? ` Лог: ${result.logFile}` : ""}`
          : (result.error ?? "ошибка"),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Создать навык"
      description={
        <>
          Ответьте на вопросы - консоль соберёт промпт и запустит его в новой headless-сессии рантайма задачи
          "Создание навыка" (сейчас:{" "}
          <span className={runtime ? "text-fg-muted" : "text-warning"}>
            {runtime ?? "не назначен - выберите в настройках или ★"}
          </span>
          ). Навык создаётся в <span className="font-mono">.agents/skills/&lt;slug&gt;/SKILL.md</span>.
        </>
      }
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="accent" size="md" disabled={busy} onClick={() => void submit()}>
            {busy ? "запуск…" : "Создать через рантайм"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Input
          size="form"
          autoFocus
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Название (например: release-notes)"
        />
        <Input
          size="form"
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
          placeholder="Краткое описание: что делает и когда включать"
        />
        <Textarea
          size="form"
          value={form.details}
          onChange={(e) => setForm({ ...form, details: e.target.value })}
          placeholder="Подробности: правила, шаги, ограничения…"
          rows={3}
        />
        <Textarea
          size="form"
          value={form.examples}
          onChange={(e) => setForm({ ...form, examples: e.target.value })}
          placeholder="Примеры запросов, при которых навык должен включаться"
          rows={3}
        />
      </div>

      {notice ? (
        <p className={`mt-3 text-[11px] ${notice.ok ? "text-accent" : "text-danger"}`}>{notice.text}</p>
      ) : null}
    </Modal>
  );
}
