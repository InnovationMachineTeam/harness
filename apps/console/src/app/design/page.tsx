import { Page } from "@/uikit";
import { DesignWorkspace } from "@/uikit/components/design/DesignWorkspace";
import { loadConsoleState } from "@/core/state";
import { findRepoRoot } from "@/core/repo";

export const dynamic = "force-dynamic";

/**
 * Раздел "Дизайн" - рабочее место дизайн-контекста обязательной директории:
 * pack (DESIGN.md, BRAND.md, ui-kit, компоненты), провайдеры дизайна
 * (Claude Design, Open Design, Figma MCP), единый запуск дизайн-задач,
 * артефакты open-design и инструменты дизайна. Тема самой консоли - в
 * "Настройках → Внешний вид".
 */
export default async function DesignPage() {
  const repoRoot = findRepoRoot();
  const state = await loadConsoleState(repoRoot);
  return (
    <Page
      title="Дизайн"
      description="Дизайн-контекст обязательной рабочей директории: DESIGN.md и BRAND.md (редакторы и синхронизация в CLAUDE.md/AGENTS.md), правила UIKit, компоненты web и mobile. Провайдеры дизайна (Claude Design, Open Design, Figma MCP), единый запуск задач через рантайм, провайдера или отдельную сессию. Тема самой консоли - в &quot;Настройках → Внешний вид&quot;."
    >
      <DesignWorkspace mandatoryDir={state.workspaces.mandatory} />
    </Page>
  );
}
