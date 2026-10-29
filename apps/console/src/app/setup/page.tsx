import type { Metadata } from "next";
import { SetupWizard } from "@/uikit/components/setup/SetupWizard";

export const metadata: Metadata = {
  title: "Установка - Harness Console",
  description: "Setup Wizard первой установки: система, пакетный менеджер, инструменты консоли",
};

/** Setup Wizard новой установки: шаги система / пакетный менеджер / инструменты / готово. */
export default function SetupPage() {
  return <SetupWizard />;
}
