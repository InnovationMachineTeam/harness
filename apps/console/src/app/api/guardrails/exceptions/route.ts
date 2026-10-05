import { NextResponse } from "next/server";
import { loadExceptions } from "@harness/guardrails";
import { findRepoRoot } from "@/core/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/guardrails/exceptions — активные, просроченные и битые исключения политики. */
export function GET() {
  const repoRoot = findRepoRoot();
  try {
    const result = loadExceptions(repoRoot);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
