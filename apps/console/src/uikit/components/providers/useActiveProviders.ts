"use client";

import { useEffect, useState } from "react";
import type { ProviderDTO } from "@/core/providers";

/**
 * Активные провайдеры реестра (проверка пройдена). С toolKey - только те, у
 * кого есть маппинг на пресеты инструмента ("openwiki" | "graphify").
 */
export function useActiveProviders(toolKey?: "openwiki" | "graphify"): ProviderDTO[] {
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/providers", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { providers?: ProviderDTO[] };
        if (!alive) return;
        setProviders(
          (json.providers ?? []).filter(
            (p) => p.status === "active" && (!toolKey || Boolean(p.tools[toolKey])),
          ),
        );
      } catch {
        /* провайдеры не критичны - поле остаётся ручным */
      }
    })();
    return () => {
      alive = false;
    };
  }, [toolKey]);
  return providers;
}
