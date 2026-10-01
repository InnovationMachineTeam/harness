"use client";

import { useEffect } from "react";
import { useConsoleStore } from "@/store/console";

/** Разовая гидрация стора с сервера после монтирования клиента. */
export function StoreHydrator() {
  const hydrate = useConsoleStore((s) => s.hydrate);
  const hydrated = useConsoleStore((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrate, hydrated]);
  return null;
}
