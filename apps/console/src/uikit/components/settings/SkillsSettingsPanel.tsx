"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useConsoleStore } from "@/store/console";
import { Button, IconButton, Panel, Toggle } from "@/uikit";
import { CreateSkillModal } from "@/uikit/components/skillsSh/CreateSkillModal";
import { InstallSkillModal } from "@/uikit/components/skillsSh/InstallSkillModal";
import { UnifiedSkillsList } from "@/uikit/components/skills/UnifiedSkillsList";

/**
 * Вкладка "Навыки" (Настройки): единый список всех навыков (internal,
 * runtime, skills.sh, plugin, workflow) с лейблами, бейджами рантаймов и
 * сегментированными фильтрами; глобальный toggle; установка skills.sh и
 * создание через рантайм; синк нативных команд рантаймов. Toggle строки -
 * значение по умолчанию для всех рантаймов; переключение выполняет хуки
 * (симлинки в обязательной папке + команды манифеста) и синк команд.
 */
export function SkillsSettingsPanel() {
  const [installOpen, setInstallOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [listKey, setListKey] = useState(0);

  return (
    <div className="space-y-6">
      <GlobalToggleSection />

      <Panel
        title="Навыки"
        actions={
          <>
            <IconButton icon={RefreshCw} label="Обновить список" onClick={() => setListKey((k) => k + 1)} />
            <Button variant="accent" onClick={() => setCreateOpen(true)}>
              Создать навык
            </Button>
            <Button variant="primary" onClick={() => setInstallOpen(true)}>
              Установить навык
            </Button>
          </>
        }
      >
        <UnifiedSkillsList key={listKey} mode="settings" />
        <p className="mt-3 text-[10px] leading-relaxed text-fg-faint">
          Toggle задаёт значение по умолчанию для всех рантаймов (per-runtime override в пространстве рантайма остаётся сильнее).
          У workflow тоггла нет - управление через workflow. Лейблы: internal - мастер-каталог, design - группа дизайн-навыков
          (.agents/skills/design, раздел "Дизайн"), skills.sh - стандартная установка, plugin - декларация плагина. Навыки из
          глобальных каталогов рантайма (лейбл runtime) показываются в пространстве рантайма.
        </p>
      </Panel>

      <CommandsSyncSection onChanged={() => setListKey((k) => k + 1)} />

      <SkillLinksSection onChanged={() => setListKey((k) => k + 1)} />

      <InstallSkillModal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onInstalled={() => setListKey((k) => k + 1)}
      />
      <CreateSkillModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

interface CommandStatus {
  runtime: string;
  commandsDir: string;
  commands: Array<{ invocation: string; file: string; title: string; present: boolean }>;
  error?: string;
}

interface CommandsSyncResponse {
  statuses: CommandStatus[];
  reports?: Array<{ runtime: string; written: string[]; removed: string[]; error?: string }>;
}

/** Синк нативных слэш-команд: статус по рантаймам и ручная регенерация. */
function CommandsSyncSection({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<CommandsSyncResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch("/api/commands/sync")
      .then((response) => response.json())
      .then((data: CommandsSyncResponse) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/commands/sync", { method: "POST" });
      const data: CommandsSyncResponse = await response.json();
      const written = (data.reports ?? []).reduce((sum, report) => sum + report.written.length, 0);
      const removed = (data.reports ?? []).reduce((sum, report) => sum + report.removed.length, 0);
      const problems = (data.reports ?? []).filter((report) => report.error).map((report) => `${report.runtime}: ${report.error}`);
      setMessage(
        problems.length
          ? `Синк выполнен с ошибками - ${problems.join("; ")}`
          : `Синк выполнен: записано ${written}, удалено ${removed}`,
      );
      load();
      onChanged?.();
    } catch (error) {
      setMessage(`Синк не выполнен - ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Команды рантаймов"
      actions={
        <Button variant="primary" onClick={() => void sync()} disabled={busy}>
          {busy ? "Синхронизация..." : "Синхронизировать"}
        </Button>
      }
    >
      {status ? (
        <div className="space-y-1.5">
          {status.statuses.map((entry) => {
            const stale = entry.commands.filter((command) => !command.present).length;
            return (
              <div key={entry.runtime} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-fg">{entry.runtime}</span>
                <span className="text-fg-faint">
                  {entry.commandsDir} - команд в плане: {entry.commands.length}
                  {entry.error ? ` - ошибка: ${entry.error}` : stale ? ` - расхождение: ${stale}` : " - актуально"}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-fg-faint">Статус синхронизации недоступен.</p>
      )}
      {message && <p className="mt-2 text-[11px] text-fg-muted">{message}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-fg-faint">
        Синк создаёт нативные слэш-команды в обязательной рабочей папке: /master:&lt;id&gt; и /workflow:&lt;id&gt;
        (Claude Code, ZCode), /master-&lt;id&gt; и /workflow-&lt;id&gt; (Cursor, OpenCode), у Codex и Kimi те же команды
        доставляются навыками (вызов /master-&lt;id&gt; и /skill:master-&lt;id&gt;). Общие /master и /workflow принимают
        "&lt;id&gt; &lt;задача&gt;". Команды работают в отдельно запущенном рантайме. Управляемые файлы помечены маркером
        консоли; чужие файлы каталогов не изменяются. Синк выполняется автоматически при переключении навыков; кнопка -
        ручная регенерация.
      </p>
    </Panel>
  );
}

function GlobalToggleSection() {
  const useGlobal = useConsoleStore((s) => s.useGlobalSkills);
  const setUseGlobal = useConsoleStore((s) => s.setUseGlobalSkills);

  return (
    <Panel>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Использовать глобальные навыки</h2>
        <Toggle
          size="md"
          checked={useGlobal === true}
          disabled={useGlobal === null}
          onChange={(value) => void setUseGlobal(value)}
          ariaLabel="использовать глобальные навыки"
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
        Базовый toggle для навыков без явного значения по умолчанию: включён - глобальные навыки рантаймов включены,
        выключен - отключены. Per-skill значение по умолчанию (список ниже) и override рантайма перекрывают его.
        Файлы навыков не изменяются.
      </p>
    </Panel>
  );
}

interface SkillLinkEntry {
  name: string;
  kind: "link" | "real" | "broken" | "other";
  points?: string;
}

interface SkillLinksStatus {
  runtime: string;
  relDir: string;
  entries: SkillLinkEntry[];
  missing: string[];
}

interface SkillLinksResponse {
  statuses: SkillLinksStatus[];
  reports?: Array<{ runtime: string; linked: string[]; removed: string[]; normalized: string[]; kept: string[]; errors: string[] }>;
}

/** Симлинки навыков: каноническое хранилище .agents/skills, каталоги рантаймов - только симлинки. */
function SkillLinksSection({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<SkillLinksResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch("/api/skills/links")
      .then((response) => response.json())
      .then((data: SkillLinksResponse) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/skills/links", { method: "POST" });
      const data: SkillLinksResponse = await response.json();
      const linked = (data.reports ?? []).reduce((sum, report) => sum + report.linked.length, 0);
      const removed = (data.reports ?? []).reduce((sum, report) => sum + report.removed.length, 0);
      const normalized = (data.reports ?? []).reduce((sum, report) => sum + report.normalized.length, 0);
      const problems = (data.reports ?? []).flatMap((report) => report.errors.map((error) => `${report.runtime}: ${error}`));
      setMessage(
        problems.length
          ? `Синк выполнен с ошибками - ${problems.join("; ")}`
          : `Синк выполнен: создано ${linked}, убрано ${removed}, заменено реальных каталогов ${normalized} (бэкап в .agents/.tmp/skill-links-backup)`,
      );
      load();
      onChanged?.();
    } catch (error) {
      setMessage(`Синк не выполнен - ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Симлинки навыков"
      actions={
        <Button variant="primary" onClick={() => void sync()} disabled={busy}>
          {busy ? "Синхронизация..." : "Синхронизировать симлинки"}
        </Button>
      }
    >
      {status ? (
        <div className="space-y-1.5">
          {status.statuses.map((entry) => {
            const real = entry.entries.filter((item) => item.kind === "real").length;
            const broken = entry.entries.filter((item) => item.kind === "broken").length;
            const foreign = entry.entries.filter((item) => item.points === "вне .agents/skills").length;
            return (
              <div key={entry.runtime} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-fg">{entry.runtime}</span>
                <span className="text-fg-faint">
                  {entry.relDir} - симлинков: {entry.entries.length - real - broken}
                  {real ? ` - реальных каталогов: ${real}` : ""}
                  {broken ? ` - битых: ${broken}` : ""}
                  {foreign ? ` - вне канона: ${foreign}` : ""}
                  {entry.missing.length ? ` - не хватает: ${entry.missing.length}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-fg-faint">Статус симлинков недоступен.</p>
      )}
      {message && <p className="mt-2 text-[11px] text-fg-muted">{message}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-fg-faint">
        Основное хранилище навыков - .agents/skills (публичные - в корне, internal - master/skills, design - design/skills);
        каталоги рантаймов содержат только симлинки. Жизненный цикл: включение/выключение (toggle) создаёт и удаляет
        симлинки, установка кладёт канонический каталог и подключает симлинки, удаление снимает симлинки и убирает
        канонический каталог. Реальные каталоги на пути симлинка переносятся в бэкап .agents/.tmp/skill-links-backup;
        чужие записи без канонического аналога не трогаются. Kimi симлинков не получает - он читает .agents/skills нативно.
      </p>
    </Panel>
  );
}
