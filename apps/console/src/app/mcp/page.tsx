"use client";

import { useState } from "react";
import { Button, Page } from "@/ui/UIKit";
import { InstallMcpModal } from "@/components/InstallMcpModal";
import { McpPanel } from "@/components/McpPanel";

export default function McpPage() {
  const [installOpen, setInstallOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <Page
      title="MCP"
      description="Глобальный реестр MCP-серверов: изменения синкаются в локальные файлы всех рантаймов в их форматах."
      actions={
        <Button variant="primary" size="md" onClick={() => setInstallOpen(true)}>
          Установить MCP
        </Button>
      }
    >
      <McpPanel key={reloadKey} />
      <InstallMcpModal
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onInstalled={() => setReloadKey((k) => k + 1)}
      />
    </Page>
  );
}
