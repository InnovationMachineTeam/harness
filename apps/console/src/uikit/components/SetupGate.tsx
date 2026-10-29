"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Gate первичной установки: на новой инсталляции (файла состояния нет или
 * setupWizard.done=false) переводит любой раздел на /setup до завершения или
 * пропуска визарда. Проверка - лёгкий GET /api/setup/gate один раз за полную
 * загрузку страницы; клиентская навигация проверки не повторяет.
 */
export function SetupGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [required, setRequired] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/setup/gate", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { required?: boolean };
        if (alive) setRequired(data.required === true);
      } catch {
        /* сервер недоступен - gate не препятствует загрузке */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (required && pathname !== "/setup") router.replace("/setup");
  }, [required, pathname, router]);

  return null;
}
