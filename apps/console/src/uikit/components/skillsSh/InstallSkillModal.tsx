"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button, Loading, Modal } from "@/uikit";
import { AuditChips, type ShAudit } from "./AuditChips";
import { InstallTerminal } from "./InstallTerminal";
import { SkillSearchField, type ShSkill } from "./SkillSearchField";

interface ShDetail {
  id: string;
  description?: string;
  descriptionSource?: "registry" | "skills.sh" | "github" | "deepwiki";
  audits: ShAudit[];
  url: string;
}

/**
 * Модалка установки навыка из skills.sh: поиск с автодополнением → карточка
 * пакета (описание + аудит) → установка через `bunx skills add` с интерактивным терминалом (вывод + ввод в stdin).
 */
export function InstallSkillModal({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  /** Вызывается после завершения установки - родитель обновляет список. */
  onInstalled?: () => void;
}) {
  const [selected, setSelected] = useState<ShSkill | null>(null);
  const [detail, setDetail] = useState<ShDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [installPkg, setInstallPkg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setDetail(null);
      setDetailLoading(false);
      setJobId(null);
      setInstallPkg(null);
    }
  }, [open]);

  const openDetail = useCallback(async (skill: ShSkill) => {
    setSelected(skill);
    setDetail(null);
    setDetailLoading(true);
    const res = await fetch(`/api/skills-sh/detail?id=${encodeURIComponent(skill.id)}`, { cache: "no-store" });
    const data = (await res.json()) as { detail?: ShDetail | null };
    setDetail(data.detail ?? null);
    setDetailLoading(false);
  }, []);

  const startInstall = async (pkg: string) => {
    setSelected(null);
    setInstallPkg(pkg);
    setJobId(null);
    const res = await fetch("/api/skills-sh/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pkg }),
    });
    const data = (await res.json()) as { jobId?: string; error?: string };
    if (data.jobId) setJobId(data.jobId);
    else setInstallPkg(`ошибка: ${data.error ?? "не удалось запустить"}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Установить навык - skills.sh"
      scroll={false}
      description={
        <>
          Установка - <span className="font-mono">bunx skills add &lt;пакет&gt; -y</span>: навык кладётся в{" "}
          <span className="font-mono">.agents/skills/</span> (+ симлинки в найденные каталоги агентов и skills-lock.json).
        </>
      }
    >
      {!installPkg ? (
        <>
          <SkillSearchField autoFocus onPick={(skill) => void openDetail(skill)} onInstallPackage={(pkg) => void startInstall(pkg)} />

          {selected ? (
            <div className="mt-4 rounded-lg border border-line-strong bg-page/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-fg">{selected.name}</h4>
                  <p className="truncate font-mono text-[11px] text-fg-faint">
                    {selected.source}
                    {selected.installs !== undefined ? ` · ${selected.installs} установок` : ""}
                  </p>
                  {selected.url || detail?.url ? (
                    <a
                      href={selected.url ?? detail?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-block truncate text-[11px] text-info underline decoration-dotted hover:text-info"
                    >
                      {selected.url ?? detail?.url}
                    </a>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="md" onClick={() => setSelected(null)}>
                    Отмена
                  </Button>
                  <Button variant="primary" size="md" onClick={() => void startInstall(selected.id)}>
                    Установить
                  </Button>
                </div>
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto">
                {detailLoading ? <Loading>загрузка описания…</Loading> : null}
                {!detailLoading && detail?.description ? (
                  <>
                    {detail.descriptionSource ? (
                      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-faint">
                        описание: {detail.descriptionSource}
                      </p>
                    ) : null}
                    <p className="text-xs leading-relaxed text-fg-muted">{detail.description}</p>
                  </>
                ) : null}
                {!detailLoading && !detail?.description && detail && (
                  <>
                    <p className="mb-2 text-xs text-fg-faint">
                      Описание получить не удалось - страница навыка встроена ниже:
                    </p>
                    <iframe
                      src={detail.url}
                      title={`Страница навыка ${selected.name}`}
                      referrerPolicy="no-referrer"
                      sandbox="allow-same-origin allow-popups"
                      className="h-64 w-full rounded-lg border border-line bg-white"
                    />
                    <a
                      href={detail.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block text-[11px] text-info underline decoration-dotted hover:text-info"
                    >
                      открыть в новой вкладке <ExternalLink size={12} aria-hidden className="inline" />
                    </a>
                  </>
                )}
                {!detailLoading && !detail ? (
                  <p className="text-xs text-fg-faint">
                    Описание и аудит недоступны - установка всё равно возможна.
                  </p>
                ) : null}
                {detail && detail.audits.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                      Аудит безопасности
                    </p>
                    <AuditChips audits={detail.audits} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-2">
          <p className="mb-2 text-xs text-fg-muted">
            установка <span className="font-mono text-fg">{installPkg}</span>
          </p>
          {jobId ? (
            <InstallTerminal jobId={jobId} />
          ) : (
            <Loading>запуск…</Loading>
          )}
          {jobId ? (
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  onInstalled?.();
                  onClose();
                }}
              >
                Готово
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
