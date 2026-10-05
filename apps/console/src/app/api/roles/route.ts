import { NextResponse } from "next/server";
import { createRole, deleteRole, loadRoles, parseRoleFile, saveRoleFile } from "@/core/workflows/catalog";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await serverContext();
  try {
    const roles = await loadRoles(ctx.repoRoot);
    return NextResponse.json({
      roles: roles.map((entry) => ({
        ...entry.value,
        folder: entry.folder,
        body: entry.body,
        text: entry.text,
        sourceFile: entry.sourceFile,
        fileName: entry.sourceFile.split(/[\\/]/).pop(),
        etag: entry.etag,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const ctx = await serverContext();
  const body = await request.json().catch(() => null) as {
    action?: string;
    folder?: string;
    id?: string;
    title?: string;
    text?: string;
    etag?: string;
  } | null;
  try {
    if (body?.action === "validate") return NextResponse.json({ ok: true, role: parseRoleFile(body.text ?? "") });
    if (body?.action === "save") {
      if (!body.id) throw new Error("id роли обязателен");
      const saved = await saveRoleFile({ root: ctx.repoRoot, folder: body.folder ?? "", id: body.id, text: body.text ?? "", expectedEtag: body.etag });
      return NextResponse.json({ ok: true, saved });
    }
    if (body?.action === "create") {
      if (!body.id) throw new Error("id роли обязателен");
      const created = await createRole({ root: ctx.repoRoot, folder: body.folder ?? "", id: body.id, title: body.title ?? body.id });
      return NextResponse.json({ ok: true, created }, { status: 201 });
    }
    if (body?.action === "delete") {
      if (!body.id) throw new Error("id роли обязателен");
      await deleteRole({ root: ctx.repoRoot, folder: body.folder ?? "", id: body.id, expectedEtag: body.etag });
      return NextResponse.json({ ok: true });
    }
    throw new Error("неизвестное действие");
  } catch (error) {
    const typed = error as Error & { code?: string; current?: string; etag?: string };
    return NextResponse.json(
      { error: typed.message, code: typed.code, current: typed.current, etag: typed.etag },
      { status: typed.code === "ETAG_CONFLICT" ? 409 : 400 },
    );
  }
}
