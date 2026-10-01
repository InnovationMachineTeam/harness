import { NextResponse } from "next/server";
import { findSkillsCached, type FoundSkill } from "@/core/skillsFind";
import { searchSkills } from "@/core/skillsSh";

export const dynamic = "force-dynamic";

/**
 * GET /api/skills-sh/search?q= - автодополнение для установки.
 * Основной источник: `bunx skills find <query>` (CLI, без API-токена);
 * HTTP API skills.sh - фолбэк и дополнение (требует VERCEL_OIDC_TOKEN).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ items: [], hint: null });

  const merged = new Map<string, FoundSkill>();

  const cli = await findSkillsCached(q);
  for (const item of cli.items) merged.set(item.id, item);

  if (merged.size < 3) {
    const api = await searchSkills(q);
    for (const item of api) {
      if (!merged.has(item.id)) {
        merged.set(item.id, {
          id: item.id,
          name: item.name,
          source: item.source,
          installs: item.installs,
          url: item.url,
        });
      }
    }
  }

  const items = [...merged.values()].slice(0, 8);
  return NextResponse.json({
    items,
    hint:
      items.length === 0
        ? "Ничего не найдено - попробуйте другое слово или введите owner/repo вручную"
        : null,
    // отладка парсера: ?debug=1 отдаёт сырой ANSI-чистый вывод CLI (кеш обходится)
    ...(url.searchParams.get("debug") === "1"
      ? { raw: (await import("@/core/skillsFind")).lastRawOutput.slice(0, 3_000) }
      : {}),
  });
}
