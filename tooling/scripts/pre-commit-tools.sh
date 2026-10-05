#!/usr/bin/env bash
# pre-commit-tools.sh - обновление индексов инструментов перед коммитом.
#
# Вызывается husky-хуком .husky/pre-commit. Best-effort: обновляет только
# УСТАНОВЛЕННЫЕ и уже инициализированные в проекте инструменты (наличие
# артефактов индексации в репозитории); отсутствующие молча пропускаются.
# Обход: SKIP_TOOLS_UPDATE=1 git commit …
#
# Реестр зеркалит apps/console/src/core/tools.ts (projectInit) - новый
# инструмент добавляется в оба места + docs/tools-dev.md.

set +e

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

[ "${SKIP_TOOLS_UPDATE:-0}" = "1" ] && exit 0

has() { command -v "$1" >/dev/null 2>&1; }

# --- CodeGraph: догон индекса (sync -q - специально для git hooks) ---
if has codegraph && [ -f .codegraph/codegraph.db ]; then
  echo "[tools] codegraph sync…"
  codegraph sync -q . || echo "[tools] codegraph sync не удался (не блокирует коммит)"
fi

# --- Graphify: догон графа (локальный tree-sitter, без LLM) ---
# Обновляет только интеграционный граф САМОГО репозитория (graphify-out/ в
# корне, создаёт setup.sh). Графы рабочих папок живут в хранилище консоли
# graphify/<имя>/graphify-out/ и обновляются её сборками (graphify extract
# --out, инкрементально); pre-commit их не трогает.
if has graphify && [ -f graphify-out/graph.json ]; then
  echo "[tools] graphify update…"
  graphify update . || echo "[tools] graphify update не удался (не блокирует коммит)"
fi

# --- Serena: переиндексация символов (LSP-кеш) ---
if has serena && [ -f .serena/project.yml ]; then
  echo "[tools] serena project index…"
  serena project index . || echo "[tools] serena index не удался (не блокирует коммит)"
fi

exit 0
