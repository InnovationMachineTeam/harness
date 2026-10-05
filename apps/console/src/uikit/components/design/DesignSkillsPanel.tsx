"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { postJson } from "@/uikit/components/design/design-api";
import { Button, Chip, EmptyState, IconButton, Loading, Notice, Panel, Toggle } from "@/uikit";
import { LifecycleInfoModal, skillLifecycleInfo } from "@/uikit/components/common/LifecycleInfoModal";

/**
 * Панель "Навыки" вкладки "Дизайн": группа design (второй internal-каталог
 * .agents/skills/design/skills, лейбл design) - навыки дизайна, установленные
 * своими утилитами (taste-skill, impeccable, ui-ux-pro-max) и привязанные
 * к рантаймам манифестом. Тоггл - уровень "default" (PATCH /api/skills);
 * "в Задачу" подставляет упоминание навыка в промт дизайн-задачи.
 */

interface DesignSkill {
  itemId: string;
  name: string;
  description: string;
  tags: string[];
  defaultEnabled: boolean;
  runtimes: Array<{ runtime: string; installed: boolean; effective: boolean }>;
  manifestHooks?: { install?: string[]; remove?: string[]; enable?: string[]; disable?: string[] };
}

export function DesignSkillsPanel(props: { onUse: (name: string) => void }) {
  const [skills, setSkills] = useState<DesignSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [infoSkill, setInfoSkill] = useState<DesignSkill | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetch("/api/skills/all").then((r) => r.json());
      const items = (data.items ?? []).filter((item: { label?: string }) => item.label === "design") as DesignSkill[];
      setSkills(items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (skill: DesignSkill, enabled: boolean) => {
    setBusy(skill.itemId);
    setError(null);
    try {
      await fetch("/api/skills", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "default", itemId: skill.itemId, enabled }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Навыки дизайна (группа design)">
      {skills === null ? (
        <Loading>читаем группу design…</Loading>
      ) : skills.length === 0 ? (
        <EmptyState size="sm">
          Группа пуста - установите дизайн-навыки (taste-skill, impeccable, ui-ux-pro-max) в .agents/skills/design/skills.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.itemId} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2 py-1.5">
              <Toggle
                size="sm"
                checked={skill.defaultEnabled}
                disabled={busy === skill.itemId}
                onChange={(value) => void toggle(skill, value)}
                ariaLabel={`навык ${skill.name}`}
              />
              <IconButton
                icon={Info}
                label={`жизненный цикл: ${skill.name}`}
                variant="ghost"
                size="xs"
                onClick={() => setInfoSkill(skill)}
              />
              <span className="text-xs font-medium text-fg">{skill.name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-faint" title={skill.description}>{skill.description}</span>
              <span className="flex items-center gap-1">
                {skill.runtimes
                  .filter((item) => item.installed)
                  .slice(0, 7)
                  .map((item) => (
                    <Chip key={item.runtime} tone={item.effective ? "emerald" : "dim"}>
                      {item.runtime}
                    </Chip>
                  ))}
              </span>
              <Button variant="ghostDim" size="xs" onClick={() => props.onUse(skill.name)}>
                В Задачу
              </Button>
            </div>
          ))}
        </div>
      )}
      {error ? <Notice tone="error" className="mt-3">{error}</Notice> : null}
      <LifecycleInfoModal
        open={infoSkill !== null}
        onClose={() => setInfoSkill(null)}
        info={skillLifecycleInfo({ label: "internal", name: infoSkill?.name ?? "", manifestHooks: infoSkill?.manifestHooks })}
      />
    </Panel>
  );
}
