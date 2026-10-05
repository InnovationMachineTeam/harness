import { NextResponse } from "next/server";
import { findRepoRoot } from "@/core/repo";
import {
  checkUpdateRegistry,
  collectUpdateTargets,
  syncUpdateRegistry,
  updateRegistryDTO,
  type UpdateRegistryDTO,
} from "@/core/updates";

export const dynamic = "force-dynamic";

/**
 * Реестр зависимостей для вкладки "Настройки → Обновить".
 * GET - быстрая синхронизация без сети (появившиеся инструменты добавляются,
 * удалённые - удаляются, версии установленного обновляются). POST - полная
 * проверка свежих версий (реестры npm/PyPI, GitHub, brew) с обновлением
 * реестра и даты проверки.
 */
export async function GET() {
  const repoRoot = findRepoRoot();
  const targets = await collectUpdateTargets(repoRoot);
  const registry = syncUpdateRegistry(repoRoot, targets);
  return NextResponse.json(updateRegistryDTO(registry) satisfies UpdateRegistryDTO);
}

export async function POST() {
  const repoRoot = findRepoRoot();
  const registry = await checkUpdateRegistry(repoRoot);
  return NextResponse.json(updateRegistryDTO(registry) satisfies UpdateRegistryDTO);
}
