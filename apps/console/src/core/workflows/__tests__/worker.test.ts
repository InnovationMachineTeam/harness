import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claimWorkerSpawn } from "../worker";

function claimFile(root: string): string {
  return path.join(root, ".agents", "console", "workflow-worker.claim");
}

async function writeClaim(root: string, content: string): Promise<void> {
  await mkdir(path.dirname(claimFile(root)), { recursive: true });
  await writeFile(claimFile(root), content);
}

describe("claimWorkerSpawn: заявка на спавн воркера", () => {
  test("свободный корень - заявка наша с pid процесса", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "worker-claim-free-"));
    try {
      expect(await claimWorkerSpawn(root)).toBe(true);
      const raw = JSON.parse(await readFile(claimFile(root), "utf8")) as { pid: number; at: string };
      expect(raw.pid).toBe(process.pid);
      expect(Number.isFinite(Date.parse(raw.at))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("живая свежая заявка другого процесса - спавн пропускается", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "worker-claim-live-"));
    try {
      await writeClaim(root, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      expect(await claimWorkerSpawn(root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("протухшая заявка с мёртвым pid захватывается", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "worker-claim-stale-"));
    try {
      const dead = spawn("true");
      await new Promise((resolve) => dead.on("exit", resolve));
      await writeClaim(root, JSON.stringify({ pid: dead.pid, at: new Date().toISOString() }));
      expect(await claimWorkerSpawn(root)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("заявка без валидного JSON захватывается", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "worker-claim-broken-"));
    try {
      await writeClaim(root, "не-json");
      expect(await claimWorkerSpawn(root)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
