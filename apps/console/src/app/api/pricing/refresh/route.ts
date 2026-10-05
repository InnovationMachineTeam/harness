import { NextResponse } from "next/server";
import { refreshCatalog } from "@/core/pricingCatalogServer";
import { findRepoRoot } from "@/core/repo";

export const dynamic = "force-dynamic";

/**
 * Обновление цен из зафиксированных источников (.agents/pricing/sources.json).
 * JSON-источники обновляют цены моделей, HTML - проверяются на доступность;
 * недоступный источник помечается и не останавливает остальные.
 */
export async function POST() {
  const repoRoot = findRepoRoot();
  const result = await refreshCatalog(repoRoot);
  return NextResponse.json(result);
}
