import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { LocalRuntimeState, ProviderPreset } from "./providers";

/**
 * Состояние локального LLM-сервиса для карточки провайдера: установлен ли
 * (бинарник в PATH или в известных путях пресета) и запущен ли (endpoint
 * отвечает). Проверки выполняются на сервере при GET /api/providers; внешние
 * процессы не запускаются - только existsSync и один HTTP-запрос.
 */

/** Таймаут запроса "запущен ли сервис". */
const RUNNING_TIMEOUT_MS = 1500;

/** Разворот `~` в домашний каталог для путей пресета. */
function expandPath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** Бинарник есть в одном из каталогов PATH или в известных путях пресета. */
export function localInstalled(preset: ProviderPreset): boolean {
  const spec = preset.local;
  if (!spec) return true;
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = new Set<string>();
  for (const dir of pathDirs) {
    for (const binary of spec.binaries) candidates.add(path.join(dir, binary));
  }
  for (const extra of spec.extraPaths ?? []) candidates.add(expandPath(extra));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return true;
  }
  return false;
}

/**
 * Endpoint локального сервиса отвечает? Любой HTTP-ответ (даже 401/404)
 * означает, что процесс жив и порт принимает соединения.
 */
export async function localRunning(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.trim().replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(RUNNING_TIMEOUT_MS),
    });
    return res.status < 600;
  } catch {
    return false;
  }
}

/** Полная проверка локального пресета; для онлайн-пресетов возвращает true/true. */
export async function checkLocalProvider(preset: ProviderPreset, baseUrl: string): Promise<LocalRuntimeState> {
  if (!preset.local) return { installed: true, running: true };
  const installed = localInstalled(preset);
  if (!installed) return { installed: false, running: false };
  return { installed: true, running: await localRunning(baseUrl) };
}
