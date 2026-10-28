import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ToolDef } from "../tools";

/**
 * Плагин инструмента OpenBot: платформа AI-котрудников CopilotKit (MIT) -
 * у каждого бота свой контейнер с Chromium и /workspace, действия проходят
 * шлюз "политика → аудит → выполнение". Локальный стек: docker compose
 * (Postgres, сервер :3001, приложение :3010, компьютеры ботов); требуется
 * Docker Desktop и ключ CopilotKit Intelligence (заполняется в .env каталога
 * клонирования, ключи - state.openbotConfig через карточку инструмента).
 * Агентов Harness OpenBot получает через AG-UI endpoint (docs/agui.md);
 * MCP-пресета нет - OpenBot не MCP-сервер.
 */

export const OPENBOT_DIR = `${homedir()}/.local/opt/openbot`;
const OPENBOT_OPT_PARENT = `${homedir()}/.local/opt`;
const OPENBOT_REPO = "https://github.com/CopilotKit/openbot";

/** Env-строка OpenBot: дописывает/заменяет ключи в .env каталога клонирования. */
export async function writeOpenbotEnvFile(env: Record<string, string>): Promise<void> {
  const file = path.join(OPENBOT_DIR, ".env");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    /* .env ещё нет - создаётся с нуля */
  }
  const lines = text.split("\n").filter((line) => line.trim() && !Object.keys(env).some((key) => line.startsWith(`${key}=`)));
  for (const [key, value] of Object.entries(env)) {
    if (value !== "") lines.push(`${key}=${value}`);
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, lines.join("\n") + "\n", "utf8");
  await rename(tmp, file);
}

export const openbotTool: ToolDef = {
  id: "openbot",
  title: "OpenBot",
  description:
    "Платформа AI-котрудников CopilotKit: у каждого бота контейнер с браузером и workspace, действия - через шлюз политики и аудита. Требует Docker Desktop и ключ CopilotKit Intelligence; агенты Harness подключаются через AG-UI endpoint (docs/agui.md).",
  docsUrl: "https://github.com/CopilotKit/openbot",
  category: "agents",
  bin: "docker",
  requires: {
    // Docker Desktop ставится вручную (brew install --cask docker или сайт);
    // compose-плагин входит в состав Docker Desktop
    bin: "docker",
    installCommand: () => null,
  },
  systemInstall: () => null,
  systemUpdate: () => (existsSync(OPENBOT_DIR) ? ["git", "-C", OPENBOT_DIR, "pull", "--ff-only"] : null),
  postInstallCommands: () => {
    const commands: string[][] = [];
    if (!existsSync(OPENBOT_DIR)) {
      commands.push(["mkdir", "-p", OPENBOT_OPT_PARENT]);
      commands.push(["git", "clone", "--depth", "1", OPENBOT_REPO, OPENBOT_DIR]);
    }
    if (!existsSync(path.join(OPENBOT_DIR, ".env"))) {
      commands.push(["cp", path.join(OPENBOT_DIR, ".env.example"), path.join(OPENBOT_DIR, ".env")]);
    }
    return commands;
  },
  dashboard: { url: "http://127.0.0.1:3010", label: "OpenBot" },
  uninstallStopsDashboard: true,
};
