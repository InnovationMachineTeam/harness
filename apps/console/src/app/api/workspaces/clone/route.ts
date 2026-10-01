import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { startToolJob } from "@/core/toolJobs";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

const SSRF_HOSTS = /^(localhost|.*\.local|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.)/;
const SSRF_172 = /^172\.(1[6-9]|2\d|3[01])\./;

function sourcesDir(repoRoot: string): string {
  return path.join(repoRoot, "sources");
}

/** GET /api/workspaces/clone - список локальных проектов в sources/. */
export async function GET() {
  const { repoRoot } = await serverContext();
  const root = sourcesDir(repoRoot);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const s = await stat(path.join(root, entry.name)).catch(() => null);
      projects.push({ name: entry.name, path: path.join(root, entry.name), git: s ? 1 : 0 });
    }
    return NextResponse.json({ dir: root, projects });
  } catch {
    return NextResponse.json({ dir: root, projects: [] });
  }
}

/**
 * POST /api/workspaces/clone {url, name?} - клонировать git-репозиторий в
 * sources/<name> (job с SSE-терминалом). Только https; хост - не
 * localhost/приватный (SSRF); имя - slug из URL или явное.
 */
export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = (await request.json().catch(() => null)) as { url?: string; name?: string } | null;
  const rawUrl = body?.url?.trim() ?? "";
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "некорректный URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "только https-URL" }, { status: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  if (SSRF_HOSTS.test(host) || SSRF_172.test(host)) {
    return NextResponse.json({ error: "localhost и приватные адреса запрещены" }, { status: 400 });
  }

  const slugSource = (body?.name?.trim() || parsed.pathname.split("/").filter(Boolean).pop() || "project")
    .replace(/\.git$/, "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  if (!slugSource) return NextResponse.json({ error: "не удалось определить имя каталога" }, { status: 400 });

  const root = sourcesDir(ctx.repoRoot);
  const target = path.resolve(root, slugSource);
  // защита от выхода за sources/
  if (target !== root && !target.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "недопустимое имя каталога" }, { status: 400 });
  }
  if (
    await stat(target)
      .then(() => true)
      .catch(() => false)
  ) {
    return NextResponse.json({ error: `каталог уже существует: sources/${slugSource}` }, { status: 400 });
  }

  const job = startToolJob({
    toolId: "workspaces",
    action: "clone",
    steps: [{ label: `git clone → sources/${slugSource}`, command: ["git", "clone", parsed.toString(), target] }],
    defaultCwd: ctx.repoRoot,
  });
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  return NextResponse.json({ ok: true, jobId: job.id, name: slugSource, target });
}
