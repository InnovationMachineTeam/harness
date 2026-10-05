import { spawn } from "node:child_process";
import type { RoadmapItem } from "./schema";

/**
 * Синхронизация roadmap-задач с AgentsPlane: CLI `agentplane` хранит задачи
 * в `.agentplane/tasks/<id>/` рабочей папки. Id задачи AgentPlane детерминирован
 * (YYYYMMDDHHMM-XXXX из createdAt и fingerprint roadmap-задачи), поэтому создание
 * идемпотентно: повторный прогон обновляет существующую задачу. Все вызовы
 * best-effort: недоступность CLI не ломает workflow и roadmap.
 */

const OWNER = "HARNESS";
const TAGS = ["harness", "backlog"];
const PRIORITY: Record<RoadmapItem["priority"], "low" | "normal" | "med" | "high"> = { low: "low", normal: "normal", high: "high", critical: "high" };

interface AgentPlaneResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  unavailable: boolean;
}

export type AgentPlaneSync = {
  id: string | null;
  action: "created" | "updated" | "exists" | "skipped" | "error" | "unavailable";
  detail?: string;
};

/** Детерминированный id задачи AgentPlane: YYYYMMDDHHMM-XXXX (UTC из createdAt + первые 4 символа fingerprint). */
export function agentPlaneTaskId(item: Pick<RoadmapItem, "createdAt" | "provenance">): string | null {
  const stamp = (item.createdAt ?? "").slice(0, 16).replace(/\D/g, "");
  const suffix = (item.provenance.fingerprint ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
  return stamp.length === 12 && suffix.length === 4 ? stamp + "-" + suffix : null;
}

function runAgentPlane(args: string[], cwd: string, timeoutMs = 30_000): Promise<AgentPlaneResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AgentPlaneResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("agentplane", args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      finish({ ok: false, stdout: "", stderr: "spawn agentplane failed", unavailable: true });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, stdout: "", stderr: "timeout: agentplane " + args.join(" "), unavailable: false });
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr: String(error), unavailable: (error as NodeJS.ErrnoException).code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr, unavailable: false });
    });
  });
}

/** Создание или обновление задачи AgentPlane из roadmap-задачи; повторный вызов обновляет метаданные. */
export async function syncTaskToAgentPlane(item: RoadmapItem, cwd: string): Promise<AgentPlaneSync> {
  const id = agentPlaneTaskId(item);
  if (!id) return { id: null, action: "skipped", detail: "нет fingerprint или createdAt - id не собрать" };
  const description = item.description || item.title;
  const exists = await runAgentPlane(["task", "show", id], cwd);
  if (exists.unavailable) return { id, action: "unavailable", detail: exists.stderr.slice(-200) };
  if (exists.ok) {
    const updated = await runAgentPlane(
      ["task", "update", id, "--title", item.title, "--description", description, "--priority", PRIORITY[item.priority], "--owner", OWNER, "--allow-primary-change"],
      cwd,
    );
    return updated.ok ? { id, action: "updated" } : { id, action: "error", detail: (updated.stderr || updated.stdout).slice(-300) };
  }
  const created = await runAgentPlane(
    ["task", "add", id, "--title", item.title, "--description", description, "--priority", PRIORITY[item.priority], "--owner", OWNER, ...TAGS.flatMap((tag) => ["--tag", tag])],
    cwd,
  );
  return created.ok ? { id, action: "created" } : { id, action: "error", detail: (created.stderr || created.stdout).slice(-300) };
}

/** Закрытие задачи AgentPlane при переводе roadmap-задачи в done или archived. */
export async function closeAgentPlaneTask(item: RoadmapItem, cwd: string): Promise<AgentPlaneSync> {
  const id = agentPlaneTaskId(item);
  if (!id) return { id: null, action: "skipped", detail: "нет fingerprint или createdAt - id не собрать" };
  const exists = await runAgentPlane(["task", "show", id], cwd);
  if (exists.unavailable) return { id, action: "unavailable", detail: exists.stderr.slice(-200) };
  if (!exists.ok) return { id, action: "skipped", detail: "задачи AgentPlane нет" };
  const status = /"status"\s*:\s*"([A-Z]+)"/.exec(exists.stdout)?.[1];
  if (status === "DONE") return { id, action: "exists" };
  const closed = await runAgentPlane(
    ["task", "complete", id, "--result", "Задача закрыта в Harness (статус " + item.status + ")", "--author", OWNER],
    cwd,
  );
  return closed.ok ? { id, action: "updated" } : { id, action: "error", detail: (closed.stderr || closed.stdout).slice(-300) };
}
