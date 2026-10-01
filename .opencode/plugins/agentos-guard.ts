// agentos-guard.ts - адаптер политики репозитория для OpenCode.
//
// OpenCode не имеет декларативных хуков в opencode.json; политика подключается
// плагином (см. .agents/runtime/opencode/config.json → vendorAdapter).
// tool.execute.before получает { tool, args } до выполнения инструмента;
// throw из хука отклоняет вызов. Сама политика - одна на все рантаймы:
// .agents/runtime/guard.mjs (exit 2 = блок, stderr = причина и "Instead: …").

import type { Plugin } from "@opencode-ai/plugin";

const GUARD = ".agents/runtime/guard.mjs";
const VENDOR_CONFIG = ".agents/runtime/opencode/config.json";

export const AgentosGuard: Plugin = async ({ client }) => {
  return {
    "tool.execute.before": async (input, output) => {
      const payload = JSON.stringify({
        tool_name: input.tool,
        tool_input: output.args ?? {},
      });

      const proc = Bun.spawnSync({
        cmd: ["node", GUARD],
        cwd: process.cwd(),
        stdin: payload,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          AGENT_RUNTIME: "opencode",
          AGENT_RUNTIME_CONFIG: VENDOR_CONFIG,
        },
      });

      const stderr = new TextDecoder().decode(proc.stderr);

      if (proc.exitCode === 2) {
        // Блок: причина уходит в ошибку - OpenCode покажет её агенту.
        throw new Error(stderr.trim() || "Blocked by repository policy (guard.mjs)");
      }

      if (proc.exitCode !== 0) {
        await client.app.log({
          body: {
            service: "agentos-guard",
            level: "error",
            message: `guard failed with exit ${proc.exitCode}: ${stderr.trim()}`,
          },
        });
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
  };
};

export default AgentosGuard;
