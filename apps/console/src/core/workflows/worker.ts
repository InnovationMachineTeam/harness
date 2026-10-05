import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { processAlive } from "../memory";

interface WorkerMeta {
  pid: number;
  startedAt: string;
}

function workerMetaFile(repoRoot: string): string {
  return path.join(repoRoot, ".agents", "console", "workflow-worker.json");
}

export async function workflowWorkerStatus(repoRoot: string): Promise<{ running: boolean; pid: number | null; startedAt: string | null }> {
  try {
    const meta = JSON.parse(await readFile(workerMetaFile(repoRoot), "utf8")) as WorkerMeta;
    return { running: processAlive(meta.pid), pid: meta.pid, startedAt: meta.startedAt };
  } catch {
    return { running: false, pid: null, startedAt: null };
  }
}

export async function ensureWorkflowWorker(repoRoot: string): Promise<{ started: boolean; pid: number | null }> {
  const current = await workflowWorkerStatus(repoRoot);
  if (current.running) return { started: false, pid: current.pid };
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
}
