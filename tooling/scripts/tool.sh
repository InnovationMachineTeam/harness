#!/usr/bin/env bash
# tool.sh - диспетчер инструментов экономии контекста для агентов.
#
# Единая точка вызова CLI-инструментов вместо N проверок `which`: состояние
# читается из .agents/console/tools.env (пишет консоль: TOOL_<ID>=on|off),
# нет строки - скрипт сам проверяет наличие бинарника в PATH.
#
# Контракт (AGENTS.md §10):
#   bash tooling/scripts/tool.sh status        # компактный статус инструментов
#   bash tooling/scripts/tool.sh <id> <args…>  # запуск инструмента с аргументами
#   exit 0 - вывод инструмента; exit 3 + stderr "TOOL_UNAVAILABLE <id>: …" -
#   инструмент не установлен или выключен: работай обычным способом (grep/Read),
#   ничего не устанавливай без запроса пользователя.
#
# Реестр зеркалит apps/console/src/core/tools.ts: новый инструмент добавляется
# в оба файла + setup.sh + docs/tools.md той же серией коммитов.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOLS_ENV="$ROOT/.agents/console/tools.env"

# id|бин|подсказка при недоступности
TOOL_SPECS=(
  "serena|serena|семантическая навигация по коду - используй mcp__serena__* рантайма или читай файлы как обычно"
  "qmd|qmd|поиск по markdown - используй обычный поиск по файлам"
  "codegraph|codegraph|обзор кода - используй grep/чтение файлов"
  "graphify|graphify|подграф знаний - используй обычный обзор файлов"
  "rtk|rtk|сжатие вывода - запускай команду напрямую"
  "headroom|headroom|прозрачный прокси - прямых вызовов нет, работай как обычно"
  "nx|nx|оркестратор задач с кешем - используй node_modules/.bin/nx проекта или скрипты package.json"
  "open-design|od|дизайн-воркспейс с MCP - установи desktop-приложение (open-design.ai); which od может находить системный octal-dump"
  "agentplane|agentplane|task lifecycle и ACR - используй встроенный task adapter Harness"
  "codeburn|codeburn|анализ расхода AI-токенов - установи глобально (bun add -g codeburn / npm install -g codeburn)"
)

usage() {
  cat <<'EOF'
Использование: bash tooling/scripts/tool.sh <id> <args…> | status | --help

  status        статус всех инструментов (on/off/missing)
  <id> <args…>  запустить инструмент; exit 3 = недоступен (обычный порядок работы)

Инструменты: serena, qmd, codegraph, graphify, rtk, headroom, nx, open-design, agentplane, codeburn.
Состояние - .agents/console/tools.env (консоль), fallback - наличие бина в PATH.
EOF
}

env_state() { # $1 - id; печатает on|off, return 1 - строки нет
  [ -r "$TOOLS_ENV" ] || return 1
  local key val
  key="TOOL_$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')="
  val="$(grep -E "^${key}(on|off)$" "$TOOLS_ENV" 2>/dev/null | tail -1 | cut -d= -f2)"
  [ -n "$val" ] || return 1
  printf '%s' "$val"
}

spec_of() { # $1 - id; печатает строку спецификации или пусто
  local line
  for line in "${TOOL_SPECS[@]}"; do
    case "$line" in
      "$1|"*) printf '%s\n' "$line"; return 0 ;;
    esac
  done
  return 0
}

bin_of() { spec_of "$1" | cut -d'|' -f2; }
hint_of() { spec_of "$1" | cut -d'|' -f3; }

has_bin() { command -v "$(bin_of "$1")" >/dev/null 2>&1; }

unavailable() { # $1 - id
  printf 'TOOL_UNAVAILABLE %s: %s\n' "$1" "$(hint_of "$1")" >&2
  exit 3
}

cmd="${1:-}"
[ -n "$cmd" ] || { usage >&2; exit 1; }

case "$cmd" in
  --help|-h) usage; exit 0 ;;
  status)
    printf '%s\n' "id        состояние"
    for line in "${TOOL_SPECS[@]}"; do
      id="$(printf '%s' "$line" | cut -d'|' -f1)"
      state="$(env_state "$id" || true)"
      if [ -z "$state" ]; then
        if has_bin "$id"; then state="on (по PATH)"; else state="missing"; fi
      fi
      printf '%-11s %s\n' "$id" "$state"
    done
    printf '\nexit 3 TOOL_UNAVAILABLE при запуске = работать обычным способом.\n'
    exit 0
    ;;
esac

# запуск: tool.sh <id> <args…>
id="$cmd"
if [ -z "$(spec_of "$id")" ]; then
  printf '[tool] неизвестный инструмент: %s (см. tool.sh --help)\n' "$id" >&2
  exit 1
fi
shift

state="$(env_state "$id" || true)"
if [ "$state" = "off" ]; then
  unavailable "$id"
fi
if [ -z "$state" ] && ! has_bin "$id"; then
  unavailable "$id"
fi

# Литеральный выбор команды - без exec переменных.
case "$id" in
  serena)    exec serena "$@" ;;
  qmd)       exec qmd "$@" ;;
  codegraph) exec codegraph "$@" ;;
  graphify)  exec graphify "$@" ;;
  rtk)       exec rtk "$@" ;;
  headroom)  exec headroom "$@" ;;
  nx)        exec nx "$@" ;;
  open-design) exec od "$@" ;;
  agentplane) exec agentplane "$@" ;;
  codeburn)  exec codeburn "$@" ;;
esac
