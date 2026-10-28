import { Page } from "@/uikit";
import { ArchitectureTabs } from "@/uikit/components/architecture/ArchitectureTabs";

/**
 * Раздел "Архитектура" - интерактивная карта harness: слои, компоненты
 * и сквозные потоки. Вкладки: карта слоёв (components/architecture/data.ts),
 * контуры системы, потоки и данные (components/architecture/views.ts,
 * перенос из docs/architecture-interactive.html); описательная часть
 * синхронизирована с docs/architecture.md.
 */
export default function ArchitecturePage() {
  return (
    <Page
      title="Архитектура"
      description="Интерактивная карта harness: слои, компоненты и сквозные потоки. Вкладки: Карта - слои и связи; Система - контуры с ответственностью, владельцем данных и отказом каждого узла; Потоки - сквозные сценарии по шагам; Данные - хранилища вокруг контракта долговечности. Подробности слоёв - в docs/architecture.md."
    >
      <ArchitectureTabs />
    </Page>
  );
}
