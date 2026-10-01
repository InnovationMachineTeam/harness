import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const REPLY_TIMEOUT_MS = 120_000;
const OUTPUT_CAP = 256_000;

/**
 * POST /api/sessions/reply {runtime, sessionId, text, cwd?}
 * Ответ выполняется headless-resume CLI - сессия продолжается новым процессом.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as
    | { runtime?: string; sessionId?: string; text?: string; cwd?: string }
    | null;
  const { runtime, sessionId, text, cwd } = body ?? {};
  if (!runtime || !sessionId || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "нужны runtime, sessionId, text" }, { status: 400 });
  }
  const adapter = ctx.adapters[runtime];
  if (!adapter) return NextResponse.json({ error: `неизвестный рантайм: ${runtime}` }, { status: 404 });
  if (!adapter.replyCommand) {
    return NextResponse.json({ error: "этот рантайм не поддерживает headless-ответ в сессию" }, { status: 400 });
  }
  const cmd = adapter.replyCommand(sessionId, text.trim());
  if (!cmd) return NextResponse.json({ error: "команда ответа недоступна" }, { status: 400 });

  const startedAt = Date.now();
  const result = await new Promise<{ code: number | null; output: string; error?: string }>((resolve) => {
    let output = "";
    let error = "";
    const child = spawn(cmd.command, cmd.args, {
      cwd: cwd && cwd.startsWith("/") ? cwd : ctx.repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, output, error: "превышен таймаут 120 с" });
    }, REPLY_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => {
      if (output.length < OUTPUT_CAP) output += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (error.length < 64_000) error += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output, error: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, error: error.trim() || undefined });
    });
  });

  return NextResponse.json({
    ok: result.code === 0,
    exitCode: result.code,
    durationMs: Date.now() - startedAt,
    output: result.output.slice(-4_000),
    stderr: result.error?.slice(-1_000),
    note: "Ответ выполнен в headless-режиме: сессия продолжается отдельным процессом",
  });
}
