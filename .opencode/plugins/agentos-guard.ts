// agentos-guard.ts - адаптер политики репозитория для OpenCode.
//
// OpenCode не имеет декларативных хуков в opencode.json; политика подключается
// плагином (см. .agents/runtime/opencode/config.json → vendorAdapter).
// tool.execute.before получает { tool, args } до выполнения инструмента;
// throw из хука отклоняет вызов. Сама политика - одна на все рантаймы:
// .guardrails/src/cli.ts (любой ненулевой exit = блок, stderr = причина).

import type { Plugin } from "@opencode-ai/plugin";

const GUARD = ".guardrails/src/cli.ts";
const POST_TOOL_USE = ".guardrails/src/posttooluse.ts";
const VENDOR_CONFIG = ".agents/runtime/opencode/config.json";

export const AgentosGuard: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const payload = JSON.stringify({
        tool_name: input.tool,
        tool_input: output.args ?? {},
      });

      const proc = Bun.spawnSync({
        cmd: ["bun", GUARD, "evaluate"],
        cwd: process.cwd(),
        stdin: payload,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          AGENT_RUNTIME: "opencode",
          AGENT_RUNTIME_CONFIG: VENDOR_CONFIG,
          GUARDRAILS_INTEGRATION: "runtime:opencode:tool.execute.before",
        },
      });

      const stderr = new TextDecoder().decode(proc.stderr);

      if (proc.exitCode !== 0) {
        throw new Error(stderr.trim() || `Guardrails завершился с кодом ${proc.exitCode}`);
      } else if (stderr.trim()) {
        // warn-правила: не блокируем, но фиксируем.
        await client.app.log({
          body: {
            service: "agentos-guard",
            level: "warn",
            message: stderr.trim(),
          },
        });
      }
    },
    // Скан вывода инструмента после исполнения: блокировка невозможна,
    // находки уходят в журнал и лог плагина.
    "tool.execute.after": async (input, output) => {
      const payload = JSON.stringify({
        tool_name: input.tool,
        tool_input: output.args ?? {},
        tool_response: output.result,
      });
      const proc = Bun.spawnSync({
        cmd: ["bun", POST_TOOL_USE],
        cwd: process.cwd(),
        stdin: payload,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          AGENT_RUNTIME: "opencode",
          AGENT_RUNTIME_CONFIG: VENDOR_CONFIG,
          GUARDRAILS_INTEGRATION: "runtime:opencode:tool.execute.after",
        },
      });
      const stderr = new TextDecoder().decode(proc.stderr);
      if (stderr.trim()) {
        await client.app.log({
          body: { service: "agentos-guard", level: "warn", message: stderr.trim() },
        });
      }
    },
  };
};

export default AgentosGuard;
