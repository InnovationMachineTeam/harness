import { globalInstallCommand, type ToolDef } from "../tools";

/** Плагин инструмента OpenWiki: сборка вики и визуализатор (вкладка "Память"). */
export const openwikiTool: ToolDef = {
  id: "openwiki",
  title: "OpenWiki",
  description:
    "Сборка вики репозитория и визуализатор графа - вкладка \"Память\". Здесь показывается только статус системного пакета.",
  docsUrl: "https://github.com/langchain-ai/openwiki",
  category: "graph",
  bin: "openwiki",
  systemInstall: (pm) => globalInstallCommand(pm, "openwiki"),
};
