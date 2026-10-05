import { NextResponse } from "next/server";
import { catalogDTO, readCatalog } from "@/core/pricingCatalogServer";
import { findRepoRoot } from "@/core/repo";

export const dynamic = "force-dynamic";

/**
 * Каталог цен (файлы .agents/pricing/): подписки вендоров и провайдеров,
 * API-цены моделей со средними, статусы зафиксированных источников.
 */
export async function GET() {
  const repoRoot = findRepoRoot();
  return NextResponse.json(catalogDTO(await readCatalog(repoRoot)));
}
