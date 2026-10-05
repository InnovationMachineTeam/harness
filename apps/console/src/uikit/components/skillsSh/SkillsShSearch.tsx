"use client";

import { useCallback, useState } from "react";
import { Button, Loading, Modal, SectionLabel } from "@/uikit";
import { AuditChips, type ShAudit } from "./AuditChips";
import { InstallTerminal } from "./InstallTerminal";
import { SkillSearchField, type ShSkill } from "./SkillSearchField";

interface ShDetail {
  id: string;
  description?: string;
  audits: ShAudit[];
  url: string;
}

/**
 * Секция поиска навыков skills.sh: автодополнение → модалка (описание + аудит)
 * → установка через bunx skills с интерактивным терминалом.
 */
export function SkillsShSearch() {
  const [modal, setModal] = useState<ShSkill | null>(null);
  const [detail, setDetail] = useState<ShDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [installPkg, setInstallPkg] = useState<string | null>(null);

  const openModal = useCallback(async (skill: ShSkill) => {
    setModal(skill);
    setDetail(null);
    setDetailLoading(true);
    const res = await fetch(`/api/skills-sh/detail?id=${encodeURIComponent(skill.id)}`, { cache: "no-store" });
    const data = (await res.json()) as { detail?: ShDetail | null };
    setDetail(data.detail ?? null);
    setDetailLoading(false);
  }, []);

  const startInstall = async (pkg: string) => {
    setModal(null);
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
    <section className="mb-6 rounded-xl border border-line bg-surface/60 p-4">
      <h2 className="mb-1 text-sm font-semibold text-fg">Установить навык - skills.sh</h2>
      <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
        Поиск по реестру <span className="font-mono">skills.sh</span>; установка - <span className="font-mono">bunx skills add &lt;пакет&gt; -y</span>,
        навык кладётся в <span className="font-mono">.agents/skills/</span> (плюс симлинки в найденные каталоги агентов и skills-lock.json).
      </p>

      <SkillSearchField
        placeholder="найти навык (например: pdf, browser, commit)…"
        onPick={(skill) => void openModal(skill)}
        onInstallPackage={(pkg) => void startInstall(pkg)}
      />

      {installPkg ? (
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
            установка <span className="font-mono text-fg">{installPkg}</span>
            <Button
              variant="ghostDim"
              size="xs"
              className="ml-auto"
              onClick={() => {
                setJobId(null);
                setInstallPkg(null);
              }}
            >
              скрыть
            </Button>
          </p>
          {jobId ? <InstallTerminal jobId={jobId} /> : <Loading>запуск…</Loading>}
        </div>
      ) : null}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.name ?? ""}
        description={
          modal ? (
            <span className="font-mono">
              {modal.source}
              {modal.installs !== undefined ? ` · ${modal.installs} установок` : ""}
            </span>
          ) : undefined
        }
        closable={false}
        scroll={false}
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setModal(null)}>
              Отмена
            </Button>
            <Button variant="primary" size="md" onClick={() => modal && void startInstall(modal.id)}>
              Установить
            </Button>
          </>
        }
      >
        <div className="max-h-64 overflow-y-auto">
          {detailLoading ? <Loading>загрузка описания…</Loading> : null}
          {!detailLoading && !detail ? (
            <p className="text-xs text-fg-faint">
              Описание и аудит недоступны (нет API-токена skills.sh) - установка всё равно возможна.
            </p>
          ) : null}
          {detail?.description ? <p className="text-xs leading-relaxed text-fg-muted">{detail.description}</p> : null}
          {detail ? (
            <div className="mt-3">
              <SectionLabel className="mb-1.5">Аудит безопасности</SectionLabel>
              <AuditChips audits={detail.audits} />
            </div>
          ) : null}
        </div>
      </Modal>
    </section>
  );
}
