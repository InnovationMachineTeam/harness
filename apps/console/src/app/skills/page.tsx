"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useConsoleStore } from "@/store/console";
import { Button, confirmDialog, IconButton, Loading, Notice, Page, Panel, Toggle } from "@/ui/UIKit";
import { CreateSkillModal } from "@/components/skillsSh/CreateSkillModal";
import { InstallSkillModal } from "@/components/skillsSh/InstallSkillModal";

interface InstalledSkill {
  id: string;
  name: string;
  source: string;
  description?: string;
  defaultEnabled?: boolean;
}

export default function SkillsPage() {
  const [installOpen, setInstallOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [installedReload, setInstalledReload] = useState(0);

  return (
    <Page
      title="Навыки"
      description={
        <>
          Установка из реестра skills.sh (в <span className="font-mono">.agents/skills</span>), создание через рантайм
          и управление включением установленных навыков.
        </>
      }
    >
      <GlobalToggleSection />

      <InstalledSection
        onInstall={() => setInstallOpen(true)}
        onCreate={() => setCreateOpen(true)}
        reloadKey={installedReload}
      />

      <InstallSkillModal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onInstalled={() => setInstalledReload((k) => k + 1)}
      />
      <CreateSkillModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </Page>
  );
}

function InstalledSection({
  onInstall,
  onCreate,
  reloadKey = 0,
}: {
  onInstall: () => void;
  onCreate: () => void;
  reloadKey?: number;
}) {
  const [items, setItems] = useState<InstalledSkill[] | null>(null);
  const [manualReload, setManualReload] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const setSkillDefault = useConsoleStore((s) => s.setSkillDefault);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/skills/installed", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { items?: InstalledSkill[] }) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, manualReload]);

  const toggle = async (item: InstalledSkill) => {
    const next = !(item.defaultEnabled ?? true);
    // порядок: сервер пишет state.json первым, затем обновляем список
    const applied = await setSkillDefault(item.id, next);
    if (applied !== null) {
      setItems((prev) =>
        prev
          ? prev.map((i) =>
              i.id === item.id ? { ...i, defaultEnabled: applied } : i,
            )
          : prev,
      );
    }
  };

  const remove = async (item: InstalledSkill) => {
    if (
      !(await confirmDialog({
        title: `Удалить навык "${item.name}"?`,
        message: `Будут удалены: .agents/skills/${item.name}, запись в skills-lock.json и симлинки в каталогах агентов.`,
        confirmLabel: "Удалить",
        tone: "danger",
      }))
    ) {
      return;
    }
    setRemoving(item.id);
    setNotice(null);
    try {
      const res = await fetch("/api/skills/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name }),
      });
      const result = (await res.json()) as { ok?: boolean; detail?: string; error?: string };
      setNotice({
        ok: Boolean(result.ok),
        text: result.ok ? (result.detail ?? "удалён") : (result.error ?? result.detail ?? "не удалось удалить"),
      });
      setManualReload((k) => k + 1);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Panel
      className="mb-6"
      title="Установленные harness-навыки"
      actions={
        <>
          <IconButton
            icon={RefreshCw}
            label="Обновить список"
            onClick={() => setManualReload((k) => k + 1)}
          />
          <Button variant="accent" onClick={onCreate}>
            Создать навык
          </Button>
          <Button variant="primary" onClick={onInstall}>
            Установить навык
          </Button>
        </>
      }
    >
      {notice ? (
        <Notice tone={notice.ok ? "success" : "error"} className="mb-2">{notice.text}</Notice>
      ) : null}
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="text-xs text-fg-faint">
          Пока пусто - установите навык из skills.sh или создайте свой; появятся в{" "}
          <span className="font-mono">.agents/skills/</span>.
        </p>
      ) : (
        <ul className="divide-y divide-line/50">
          {items.map((item) => {
            const enabled = item.defaultEnabled ?? true;
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-fg">{item.name}</p>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-faint" title={item.description}>
                      {item.description}
                    </p>
                  ) : null}
                  <p className="truncate font-mono text-[10px] text-fg-faint" title={item.source}>
                    {item.source}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-[11px] ${enabled ? "text-accent" : "text-fg-faint"}`}>
                    {enabled ? "вкл" : "выкл"}
                  </span>
                  <Toggle
                    checked={enabled}
                    onChange={() => void toggle(item)}
                    title="Значение по умолчанию для всех рантаймов (перекрывается тогглом в пространстве рантайма)"
                    ariaLabel={`навык ${item.name}`}
                  />
                  <Button
                    variant="danger"
                    size="xs"
                    disabled={removing === item.id}
                    onClick={() => void remove(item)}
                    title="Удалить навык (.agents/skills, lock-файл, симлинки агентов)"
                  >
                    {removing === item.id ? "…" : "удалить"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-fg-faint">
        Toggle задаёт значение по умолчанию для всех рантаймов (per-runtime override в пространстве рантайма
        остаётся сильнее). Порядок применения: сначала запись файла состояния, затем обновление интерфейса.
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
        выключен - отключены. Per-skill значение по умолчанию (список выше) и override рантайма перекрывают его.
        Файлы навыков не изменяются.
      </p>
    </Panel>
  );
}
