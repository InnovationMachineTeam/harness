import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { processAlive } from "../memory";

interface WorkerMeta {
  pid: number;
  startedAt: string;
}

function workerMetaFile(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "workflow-worker.json");
}

/** Заявка на спавн: исключительное создание файла не даёт двум вызовам заспавнить двух воркеров. */
function workerClaimFile(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "workflow-worker.claim");
}

/** Заявка старше этого возраста считается протухшей независимо от живости процесса-создателя. */
const CLAIM_TTL_MS = 60_000;

/**
 * Захват заявки на спавн. true - заявка наша, вызывавший спавнит; null - живая
 * свежая заявка другого процесса (воркер появится без нашего участия).
 * Протухшая заявка (создатель мёртв или возраст больше TTL) захватывается.
 */
export async function claimWorkerSpawn(repoRoot: string): Promise<boolean | null> {
  const claim = workerClaimFile(repoRoot);
  await mkdir(path.dirname(claim), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: FileHandle;
    try {
      handle = await open(claim, "wx");
    } catch {
      try {
        const raw = JSON.parse(await readFile(claim, "utf8")) as { pid?: number; at?: string };
        const fresh = typeof raw.at === "string" && Date.now() - Date.parse(raw.at) < CLAIM_TTL_MS;
        if (fresh && typeof raw.pid === "number" && processAlive(raw.pid)) return null;
      } catch {
        // Битая заявка - захватываем.
      }
      await rm(claim, { force: true }).catch(() => undefined);
      continue;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      return true;
    } finally {
      await handle.close();
    }
  }
  return null;
}

export async function workflowWorkerStatus(repoRoot: string): Promise<{ running: boolean; pid: number | null; startedAt: string | null }> {
  try {
    const meta = JSON.parse(await readFile(workerMetaFile(repoRoot), "utf8")) as WorkerMeta;
    return { running: processAlive(meta.pid), pid: meta.pid, startedAt: meta.startedAt };
  } catch {
    return { running: false, pid: null, startedAt: null };
  }
}

/** Сериализация вызовов одного процесса: параллельные HTTP-запросы не проходят проверку одновременно. */
const ensureInFlight = new Map<string, Promise<{ started: boolean; pid: number | null }>>();

export function ensureWorkflowWorker(repoRoot: string): Promise<{ started: boolean; pid: number | null }> {
  const inFlight = ensureInFlight.get(repoRoot);
  if (inFlight) return inFlight;
  const promise = doEnsureWorkflowWorker(repoRoot).finally(() => ensureInFlight.delete(repoRoot));
  ensureInFlight.set(repoRoot, promise);
  return promise;
}

async function doEnsureWorkflowWorker(repoRoot: string): Promise<{ started: boolean; pid: number | null }> {
  const current = await workflowWorkerStatus(repoRoot);
  if (current.running) return { started: false, pid: current.pid };
  const claimed = await claimWorkerSpawn(repoRoot);
  if (claimed !== true) return { started: false, pid: null };
  try {
    // Повторная проверка под заявкой: параллельный вызов мог успеть заспавнить раньше.
    const recheck = await workflowWorkerStatus(repoRoot);
    if (recheck.running) return { started: false, pid: recheck.pid };
    const dir = path.join(repoRoot, ".agents", "console");
    await mkdir(dir, { recursive: true });
    const logFile = path.join(dir, "workflow-worker.log");
    const handle = await open(logFile, "a");
    const entry = path.join(repoRoot, "apps", "console", "src", "workflow-worker.ts");
    const child = spawn("bun", [entry, repoRoot], {
      cwd: repoRoot,
      env: { ...process.env, HARNESS_WORKFLOW_WORKER: "1" },
      detached: true,
      stdio: ["ignore", handle.fd, handle.fd],
    });
    child.unref();
    await handle.close();
    if (!child.pid) return { started: false, pid: null };
    await writeFile(workerMetaFile(repoRoot), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }, null, 2) + "\n");
    return { started: true, pid: child.pid };
  } finally {
    await rm(workerClaimFile(repoRoot), { force: true }).catch(() => undefined);
  }
}
