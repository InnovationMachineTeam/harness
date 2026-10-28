import { Page } from "@/uikit";
import { ReaWorkspace } from "@/uikit/components/rea/ReaWorkspace";

export const dynamic = "force-dynamic";

/** Раздел "Реверс": рабочее место реверс-инжиниринга поверх инструмента rea. */
export default function ReaPage() {
  return (
    <Page
      title="Реверс"
      description="Реверс-инжиниринг приложений и бинарников без исходников: анализ, инспекторы форматов, среды для агентов. Результаты для развития - в sources/."
    >
      <ReaWorkspace />
    </Page>
  );
}
