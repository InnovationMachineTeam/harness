import { spawn } from "node:child_process";
import { listProcesses, verifyPidFresh } from "@/lib/signals/processes";

export type { PsInfoFull } from "@/lib/signals/processes";
export { parsePsLine, resetPsCache } from "@/lib/signals/processes";
export { listProcesses };

export interface ActionResult {
  ok: boolean;
  action: "stop" | "restart";
  pid: number;
  detail: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Остановить процесс рантайма: SIGTERM, до 3 с грации, затем SIGKILL.
 * Перед сигналом перепроверяем по свежему ps, что PID всё ещё принадлежит рантайму.
 */
export async function stopProcess(pid: number, pattern: RegExp): Promise<ActionResult> {
  const info = verifyPidFresh(pid, pattern);
  if (!info) {
    return { ok: false, action: "stop", pid, detail: "процесс не найден или больше не относится к рантайму" };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    return { ok: false, action: "stop", pid, detail: `не удалось отправить SIGTERM: ${String(err)}` };
  }
  for (let i = 0; i < 10 && pidAlive(pid); i++) {
    await new Promise((r) => setTimeout(r, 300));
  }
  let method = "SIGTERM";
  if (pidAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
      method = "SIGKILL";
    } catch {
      /* уже ушёл */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    ok: !pidAlive(pid),
    action: "stop",
    pid,
    detail: pidAlive(pid) ? `не удалось остановить (${method})` : `остановлен (${method})`,
  };
}

/**
 * Перезапустить приложение рантайма (.app): остановка + `open -a <ИмяПриложения>`.
 * Для CLI-процессов перезапуск не поддерживается - их запускает пользователь.
 */
export async function restartProcess(pid: number, pattern: RegExp): Promise<ActionResult> {
  const info = verifyPidFresh(pid, pattern);
  if (!info) {
    return { ok: false, action: "restart", pid, detail: "процесс не найден или больше не относится к рантайму" };
  }
  const appName = info.command.match(/\/Applications\/([^/]+)\.app\//)?.[1];
  if (!appName) {
    return {
      ok: false,
      action: "restart",
      pid,
      detail: "перезапуск поддерживается только для приложений (.app); CLI-процессы запускаются пользователем",
    };
  }
  const stop = await stopProcess(pid, pattern);
  if (!stop.ok) return stop;
  const child = spawn("open", ["-a", appName], { detached: true, stdio: "ignore" });
  child.unref();
  await new Promise((r) => setTimeout(r, 800));
  return { ok: true, action: "restart", pid, detail: `${appName}: остановлен и запущен заново (open -a)` };
}
