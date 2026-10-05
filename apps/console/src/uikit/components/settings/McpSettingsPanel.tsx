"use client";

import { useState } from "react";
import { Button } from "@/uikit";
import { InstallMcpModal } from "@/uikit/components/InstallMcpModal";
import { McpPanel } from "@/uikit/components/McpPanel";

/** Вкладка "MCP" (Настройки): глобальный реестр MCP-серверов и синк в рантаймы. */
export function McpSettingsPanel() {
  const [installOpen, setInstallOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" size="md" onClick={() => setInstallOpen(true)}>
          Установить MCP
        </Button>
      </div>
      <McpPanel key={reloadKey} />
      <InstallMcpModal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onInstalled={() => setReloadKey((k) => k + 1)}
      />
    </>
  );
}
