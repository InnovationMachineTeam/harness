import { spawnSync } from "node:child_process";
import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_OUTPUT = 20_000;

function audit(repoRoot: string) {
  const result = spawnSync("bun", [".guardrails/src/cli.ts", "audit", "--json"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? "аудит не выполнен");
  return JSON.parse(result.stdout) as unknown;
}

/** GET /api/guardrails — актуальный снимок каталога, тестового покрытия и wiring. */
export function GET() {
  const repoRoot = findRepoRoot();
  try { return NextResponse.json(audit(repoRoot)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

/** POST /api/guardrails {action} — только фиксированные команды аудитора. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const action = body?.action;
  const commands: Record<string, string[]> = {
    check: [".guardrails/src/cli.ts", "check"],
    test: ["test", ".guardrails/tests"],
    generate: [".guardrails/src/cli.ts", "generate"],
  };
  if (typeof action !== "string" || !commands[action]) return NextResponse.json({ error: "action: check | test | generate" }, { status: 400 });
  const repoRoot = findRepoRoot();
  const result = spawnSync("bun", commands[action], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-MAX_OUTPUT).trim();
  try {
    return NextResponse.json({ ok: !result.error && result.status === 0, status: result.status, output, snapshot: audit(repoRoot) }, { status: result.error ? 500 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, status: result.status, output, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
