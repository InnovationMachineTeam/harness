import { globalInstallCommand, type ToolDef } from "../tools";

/** Плагин инструмента rea: реверс-инжиниринг приложений и бинарников без исходников. */
export const reaTool: ToolDef = {
  id: "rea",
  title: "REA",
  description:
    "Реверс-инжиниринг приложений и бинарников без исходников (Reverse Engineer Anything): анализ, декомпиляция, evidence с указанием ограничений. CLI и MCP-сервер.",
  docsUrl: "https://github.com/morluto/rea",
  category: "code",
  bin: "rea",
  systemInstall: (pm) => globalInstallCommand(pm, "rea-agents"),
  systemUpdate: (pm) => globalInstallCommand(pm, "rea-agents@latest"),
  mcpPreset: (params) =>
    params.compactMcpOutput
      ? {
          type: "stdio",
          command: "rea",
          args: ["mcp"],
          env: { REA_MCP_OUTPUT_SCHEMA_PROFILE: "compact" },
        }
      : { type: "stdio", command: "rea", args: ["mcp"] },
  perRuntime: {
    supported: [],
    installCommand: () => [],
    uninstallCommand: () => [],
    params: [
      {
        key: "compactMcpOutput",
        label: "Компактный профиль ответов MCP (REA_MCP_OUTPUT_SCHEMA_PROFILE=compact)",
        hint: "Сокращает ответы инструментов rea: меньше байт в контексте агента",
      },
    ],
  },
};
