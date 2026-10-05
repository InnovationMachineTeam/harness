"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button, Input, Modal, Select, confirmDialog } from "@/uikit";

/** Статус git-репозитория рабочей папки (GET /api/git/status). */
export interface GitStatusDTO {
  gitAvailable: boolean;
  isRepo: boolean;
  current: string | null;
  branches: string[];
  empty: boolean;
}

/** Значение селектора веток для пункта "Создать новую ветку…". */
export const NEW_BRANCH = "__new__";

/**
 * Строка над полем ввода вкладки "Агент": рабочая директория и ветка внутри
 * неё. Нет git или репозитория - кнопка "✕ Git" с предложением инициализации;
 * репозиторий есть - селектор веток с переключением и пунктом создания новой.
 */
export function WorkspaceBar({
  dirs,
  cwd,
  onCwd,
  git,
  onBranchChange,
  disabled,
}: {
  dirs: { path: string; exists: boolean }[];
  cwd: string;
  onCwd: (dir: string) => void;
  git: GitStatusDTO | null;
  onBranchChange: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);

  const dirOptions = dirs.map((d) => ({ value: d.path, label: d.path + (d.exists ? "" : " (нет папки)") }));

  const branchValue = git?.current ?? "";

  const branchOptions = git?.isRepo
    ? [
        ...(git.branches.length > 0
          ? git.branches.map((b) => ({ value: b, label: b + (b === branchValue ? " (текущая)" : "") }))
          : branchValue
            ? [{ value: branchValue, label: `${branchValue} (нет коммитов)` }]
            : []),
        { value: NEW_BRANCH, label: "Создать новую ветку…" },
      ]
    : [];

  const gitPost = async (body: { name?: string; create?: boolean }): Promise<string | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/git/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: cwd, ...body }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) return json.error ?? "операция git не выполнена";
      onBranchChange();
      return null;
    } catch {
      return "сеть недоступна - операция git не выполнена";
    } finally {
      setBusy(false);
    }
  };

  const initGit = async () => {
    const ok = await confirmDialog({
      title: "Инициализировать Git-репозиторий?",
      message: `В рабочей директории ${cwd} нет git-репозитория. Выполнить git init?`,
      confirmLabel: "Инициализировать",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/git/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: cwd }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setBranchError(json.error ?? "git init не выполнен");
        return;
      }
      onBranchChange();
    } catch {
      setBranchError("сеть недоступна - git init не выполнен");
    } finally {
      setBusy(false);
    }
  };

  const onBranchSelect = (value: string) => {
    setBranchError(null);
    if (value === NEW_BRANCH) {
      setBranchName("");
      setBranchModalOpen(true);
      return;
    }
    if (value && value !== branchValue) {
      setBranchError(null);
      void gitPost({ name: value, create: false }).then((err) => setBranchError(err));
    }
  };

  const createBranch = async () => {
    const err = await gitPost({ name: branchName, create: true });
    if (err) {
      setBranchError(err);
      return;
    }
    setBranchModalOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select
            value={cwd}
            onChange={onCwd}
            size="sm"
            className="w-full"
            ariaLabel="рабочая директория"
            options={dirOptions}
            disabled={disabled || dirs.length === 0}
          />
        </div>
        {git === null ? (
          <span className="shrink-0 px-2 text-[11px] text-fg-faint">ветка: …</span>
        ) : git.isRepo ? (
          <div className="w-52 shrink-0">
            <Select
              value={branchValue || NEW_BRANCH}
              onChange={onBranchSelect}
              size="sm"
              className="w-full"
              ariaLabel="ветка рабочей директории"
              options={branchOptions}
              disabled={disabled || busy}
            />
          </div>
        ) : (
          <Button variant="ghostDim" size="sm" onClick={() => void initGit()} disabled={disabled || busy}>
            <X size={12} aria-hidden className="text-danger" /> Git
          </Button>
        )}
      </div>
      {branchError ? <p className="text-[11px] text-danger">{branchError}</p> : null}

      <Modal
        open={branchModalOpen}
        onClose={() => setBranchModalOpen(false)}
        title="Создать новую ветку"
        description={`Рабочая директория: ${cwd}. Ветка будет создана от текущей (${branchValue || "нет коммитов"}) и станет активной.`}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBranchModalOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={() => void createBranch()} disabled={!branchName.trim() || busy}>
              Создать ветку
            </Button>
          </>
        }
      >
        <Input
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="имя ветки, например feature/agent-tab"
          aria-label="имя новой ветки"
          autoFocus
        />
        {branchError ? <p className="mt-2 text-[11px] text-danger">{branchError}</p> : null}
      </Modal>
    </div>
  );
}
