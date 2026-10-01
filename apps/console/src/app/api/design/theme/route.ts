import { NextResponse } from "next/server";
import { readThemeFile } from "@/core/design";
import { serverContext } from "@/lib/server-context";

export const dynamic = "force-dynamic";

/** Ленивое чтение файла пресета из themes/ (предпросмотр по клику на карточку). */
export async function GET(request: Request) {
  const { repoRoot } = await serverContext();
  const file = new URL(request.url).searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "нужен параметр file" }, { status: 400 });
  }
  const result = await readThemeFile(repoRoot, file);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ file, name: result.name, content: result.content });
}
