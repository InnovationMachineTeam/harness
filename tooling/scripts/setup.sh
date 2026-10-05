#!/usr/bin/env bash
# setup.sh - установка системных зависимостей harness.
#
# Скрипт показывает статус системы (ОС, arch, найденные инструменты и их
# версии), перечисляет, что будет установлено, и после подтверждения
# пользователя ставит недостающее: macOS - Homebrew (нет brew - предложит
# поставить и его), Linux - официальный инсталлер bun и NodeSource для node.
# Отдельно спрашивается пакетный менеджер глобальных npm-пакетов (Bun/NPM)
# и предлагается блок опциональных инструментов консоли (Serena, qmd,
# CodeGraph, Graphify, RTK, Headroom, Open Design - экономия токенов агентов).
# Системные POSIX-утилиты (ps, sh, which, open, git) только проверяются.
# Рантаймы агентов (Claude Code, Codex, ZCode, Cursor, Kimi, OpenCode)
# в установку НЕ входят - их ставит пользователь самостоятельно.
#
# Внешние инсталлеры (Homebrew, bun, NodeSource, uv, rtk) не исполняются из
# пайпа: скрипт скачивает их в .agents/.tmp/setup/ и запускает файлами -
# содержимое можно просмотреть до выполнения.
#
# Контракт:
#   запуск : bash tooling/scripts/setup.sh [--check] [--yes]
#            или bun run setup [-- --check] из корня репозитория
#   --check, -c - только статус системы, без вопросов и установки
#   --yes,   -y - не спрашивать подтверждение (неинтерактивный режим)
#   exit 0 - всё на месте, установка отменена или прошла успешно
#   exit 1 - неизвестный аргумент, неподдерживаемая ОС, отказ от
#            подтверждения или ошибка установки
#
# Правило поддержки (AGENTS.md §10): фича начала использовать новый внешний
# инструмент - в той же серии коммитов добавь его в статус/установку ниже,
# в core/tools.ts консоли и tooling/scripts/tool.sh.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$ROOT/.agents/.tmp/setup"
PM_FILE="$ROOT/.agents/console/package-manager.json"

# --- Аргументы ---

CHECK_ONLY=0
ASSUME_YES=0
usage() {
  cat <<'EOF'
Использование: bash tooling/scripts/setup.sh [--check] [--yes]

  --check, -c  только показать статус системы (без вопросов и установки)
  --yes,   -y  не спрашивать подтверждение (неинтерактивный режим)
  --help,  -h  эта справка

Проверяет bun (+bunx), node (≥ 22), openwiki и опциональные инструменты
консоли (Serena, qmd, CodeGraph, Graphify, RTK, Headroom, Open Design),
устанавливает недостающее (macOS - Homebrew, Linux - официальные инсталлеры;
npm-пакеты - выбранным менеджером Bun/NPM). Рантаймы агентов (Claude Code,
Codex, ZCode, Cursor, Kimi, OpenCode) не устанавливаются.
EOF
}
for arg in "$@"; do
  case "$arg" in
    --check|-c) CHECK_ONLY=1 ;;
    --yes|-y)   ASSUME_YES=1 ;;
    --help|-h)  usage; exit 0 ;;
    *)
      echo "[setup] неизвестный аргумент: $arg (доступны --check/-c, --yes/-y, --help/-h)" >&2
      exit 1
      ;;
  esac
done

# --- Вывод (цвета - только в интерактивном терминале) ---

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_R=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_R=""
fi

say()  { printf '[setup] %s\n' "$*"; }
line() { printf '%s\n' "$(printf '%.0s=' {1..64})"; }
ok()   { printf '  %s✓%s %s\n' "$C_OK" "$C_R" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_R" "$*"; }
miss() { printf '  %s✗%s %s\n' "$C_ERR" "$C_R" "$*"; }
hint() { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_R"; }

# Вопрос [y/N]; при --yes - автоматически "да", при неинтерактивном stdin - "нет".
confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local reply=""
  if [ ! -t 0 ]; then
    say "$1"
    say "stdin не интерактивен - считаем отказ. Для авто-подтверждения запустите с --yes."
    return 1
  fi
  printf '%s [y/N]: ' "$1"
  IFS= read -r reply
  case "$reply" in
    y|Y|yes|Yes|YES|д|Д|да|Да|ДА) return 0 ;;
    *) return 1 ;;
  esac
}

# Вопрос [Y/n] - по умолчанию "да" (для необязательных шагов).
confirm_default_yes() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local reply=""
  if [ ! -t 0 ]; then
    say "$1"
    say "stdin не интерактивен - считаем отказ. Для авто-подтверждения запустите с --yes."
    return 1
  fi
  printf '%s [Y/n]: ' "$1"
  IFS= read -r reply
  case "$reply" in
    n|N|no|No|NO|н|Н|нет|Нет|НЕТ) return 1 ;;
    *) return 0 ;;
  esac
}

has() { command -v "$1" >/dev/null 2>&1; }

# --- Пакетный менеджер глобальных npm-пакетов: Bun (bun add -g / bunx) или NPM (npm i -g / npx) ---
# Выбор персистится в .agents/console/package-manager.json (его читает консоль
# для команд установки и MCP-пресетов bunx/npx).

PM="bun"; PM_SAVED=1
if [ -r "$PM_FILE" ]; then
  if grep -q '"packageManager": *"npm"' "$PM_FILE" 2>/dev/null; then PM="npm"; fi
else
  PM_SAVED=0
fi

read_pm_choice() { # интерактивный выбор при отсутствии сохранённого
  if [ "$PM_SAVED" = 1 ] || [ "$CHECK_ONLY" = 1 ]; then return; fi
  if [ -t 0 ]; then
    printf 'Пакетный менеджер глобальных npm-пакетов: 1) Bun (по умолчанию) 2) NPM? '
    IFS= read -r reply
    case "$reply" in
      2|n|N|npm|npm\*) PM="npm" ;;
      *) PM="bun" ;;
    esac
  fi
  # --yes/неинтерактив: остаётся bun (по умолчанию)
  mkdir -p "$(dirname "$PM_FILE")"
  printf '{\n  "packageManager": "%s"\n}\n' "$PM" > "$PM_FILE"
  say "Выбор менеджера сохранён: ${PM} ($PM_FILE)."
}

npm_global() { # печатает команду глобальной установки с учётом PM
  if [ "$PM" = "bun" ]; then
    printf 'bun add -g'
  else
    printf 'npm install -g'
  fi
}
npm_global_cmd() { # массив для run_step
  if [ "$PM" = "bun" ]; then
    echo bun; echo add; echo -g
  else
    echo npm; echo install; echo -g
  fi
}

# --- Платформа ---

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) OS_PRETTY="macOS $(sw_vers -productVersion 2>/dev/null || echo '?')" ;;
  Linux)
    OS_PRETTY="Linux"
    # shellcheck disable=SC1091
    [ -r /etc/os-release ] && . /etc/os-release && OS_PRETTY="Linux (${PRETTY_NAME:-?})"
    ;;
  *)
    line
    miss "Неподдерживаемая ОС: $OS - установка возможна только на macOS или Linux."
    exit 1
    ;;
esac

read_pm_choice

# --- Статус системы ---

line
printf 'СТАТУС СИСТЕМЫ   (harness: установка системных зависимостей)\n'
line
printf '  ОС:            %s (%s)\n' "$OS_PRETTY" "$ARCH"
printf '  npm-пакеты:    %s (%s%s%s)%s\n' \
  "$([ "$PM" = "bun" ] && echo 'Bun: bun add -g / bunx' || echo 'NPM: npm install -g / npx')" \
  "$C_DIM" "$([ "$PM_SAVED" = 1 ] && echo 'сохранён' || echo 'по умолчанию, не задан')" "$C_R" ""
if [ "$OS" = "Darwin" ]; then
  if has brew; then
    printf '  Менеджер:      Homebrew (%s)\n' "$(brew --version 2>/dev/null | head -1)"
  else
    printf '  Менеджер:      %sHomebrew не найден%s - для установки будет предложен он\n' "$C_WARN" "$C_R"
  fi
else
  if has apt-get; then
    printf '  Менеджер:      apt (NodeSource для node ≥ 22)\n'
  else
    printf '  Менеджер:      %sapt не найден%s - bun поставит инсталлер, node: вручную\n' "$C_WARN" "$C_R"
  fi
fi

printf '\nЗАВИСИМОСТИ HARNESS\n\n'

BUN_STATUS="ok";     BUN_VER=""
NODE_STATUS="ok";    NODE_VER=""
WIKI_STATUS="ok"
NODE_MIN_MAJOR=22

if has bun; then
  BUN_VER="$(bun --version 2>/dev/null || echo '?')"
  ok "bun ${BUN_VER} (+bunx) ${C_DIM}- менеджер пакетов, раннер скриптов, bunx skills${C_R}"
else
  BUN_STATUS="missing"
  miss "bun (+bunx) - НЕ НАЙДЕН"
  hint "нужен для: bun install / bun run, тесты (bun test), навыки (bunx skills …)"
fi

if has node; then
  NODE_VER="$(node --version 2>/dev/null || echo '?')"
  NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed 's/^v//' | cut -d. -f1)"
  if [ "${NODE_MAJOR:-0}" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null; then
    ok "node ${NODE_VER} ${C_DIM}- guard-хуки рантаймов, headless ZCode, база для openwiki${C_R}"
  else
    NODE_STATUS="old"
    warn "node ${NODE_VER} - НУЖНО ОБНОВЛЕНИЕ (требуется ≥ ${NODE_MIN_MAJOR})"
    hint "openwiki требует Node ≥ 22; guard работает и на старых, но обновление обязательно к установке"
  fi
else
  NODE_STATUS="missing"
  miss "node (≥ ${NODE_MIN_MAJOR}) - НЕ НАЙДЕН"
  hint "нужен для: guard-хуки всех рантаймов (.agents/runtime/guard.mjs), openwiki"
fi

if has openwiki; then
  # У openwiki CLI нет флага --version (docs/operations.md) - детекция по наличию.
  ok "openwiki ${C_DIM}- опциональный: вкладка \"Память\" (сборка вики, визуализатор)${C_R}"
else
  WIKI_STATUS="missing"
  miss "openwiki (опциональный) - НЕ НАЙДЕН"
  hint "вкладка \"Память\": сборка вики и граф ($(npm_global) openwiki)"
fi

printf '\nСИСТЕМНЫЕ УТИЛИТЫ (только проверяются, установки не требуют)\n\n'
SYS_TOOLS="ps sh which git"
[ "$OS" = "Darwin" ] && SYS_TOOLS="$SYS_TOOLS open"
SYS_MISSING=""
for t in $SYS_TOOLS; do
  if has "$t"; then
    printf '  %s✓%s %s\n' "$C_OK" "$C_R" "$t"
  else
    SYS_MISSING="$SYS_MISSING $t"
    printf '  %s✗%s %s\n' "$C_ERR" "$C_R" "$t"
  fi
done
if [ -n "$SYS_MISSING" ]; then
  hint "отсутствуют системные утилиты:${SYS_MISSING} - установите их из пакетов ОС"
fi

# --- Опциональные инструменты консоли (экономия токенов агентов) ---

printf '\nОПЦИОНАЛЬНЫЕ ИНСТРУМЕНТЫ КОНСОЛИ (экономия токенов; per-runtime настройка - в консоли)\n\n'

OPT_ACTIONS=()      # serena | qmd | codegraph | graphify | rtk | headroom | nx | open-design | agentplane | codeburn | uv
OPT_DESC=()

opt_status() { # $1 - bin, $2 - подпись, $3 - действие, $4 - описание шага
  if has "$1"; then
    ok "$2"
  else
    miss "$2 - НЕ НАЙДЕН"
    OPT_ACTIONS+=("$3")
    OPT_DESC+=("$4")
  fi
}

opt_status "serena" "serena ${C_DIM}- семантическая навигация по коду (LSP, MCP)${C_R}" \
  "serena" "serena - uv tool install -p 3.13 serena-agent"
opt_status "qmd" "qmd ${C_DIM}- локальный поиск по markdown (MCP)${C_R}" \
  "qmd" "qmd - $(npm_global) @tobilu/qmd"
opt_status "codegraph" "codegraph ${C_DIM}- knowledge graph кода (MCP + per-runtime)${C_R}" \
  "codegraph" "codegraph - $(npm_global) @colbymchenry/codegraph"
opt_status "graphify" "graphify ${C_DIM}- граф знаний кода/доков (skill/hooks + вкладка \"Память\")${C_R}" \
  "graphify" "graphify - uv tool install graphifyy"
if [ "$OS" = "Darwin" ]; then
  opt_status "rtk" "rtk ${C_DIM}- сжатие вывода shell-команд (хуки рантаймов)${C_R}" \
    "rtk" "rtk - brew install rtk"
else
  opt_status "rtk" "rtk ${C_DIM}- сжатие вывода shell-команд (хуки рантаймов)${C_R}" \
    "rtk" "rtk - официальный инсталлер rtk-ai (файлом)"
fi
opt_status "headroom" "headroom ${C_DIM}- сжатие контекста перед LLM (прокси/MCP)${C_R}" \
  "headroom" "headroom - uv tool install --python 3.13 headroom-ai[all]"
opt_status "nx" "nx ${C_DIM}- оркестратор задач с кешем (nx.json, verify)${C_R}" \
  "nx" "nx - $(npm_global) nx"
opt_status "agentplane" "agentplane ${C_DIM}- lifecycle задач, verification и ACR${C_R}" \
  "agentplane" "agentplane - $(npm_global) agentplane"
opt_status "codeburn" "codeburn ${C_DIM}- анализ расхода AI-токенов (отчёт CodeBurn)${C_R}" \
  "codeburn" "codeburn - $(npm_global) codeburn"
# od из Open Design проверяется отдельно: `which od` находит системный
# octal-dump (/usr/bin/od) - установленность определяем по выводу od --help
# или по наличию desktop-приложения.
has_od() {
  command -v od >/dev/null 2>&1 && od mcp --help 2>/dev/null | grep -q -- "--daemon-url"
}
if has_od || [ -d "/Applications/Open Design.app" ]; then
  ok "open-design ${C_DIM}- дизайн-воркспейс с MCP (desktop-приложение, CLI od)${C_R}"
else
  miss "open-design ${C_DIM}- дизайн-воркспейс с MCP (desktop-приложение, CLI od)${C_R} - НЕ НАЙДЕН"
  OPT_ACTIONS+=("open-design")
  OPT_DESC+=("open-design - desktop-приложение (DMG GitHub Releases) + обёртка od в ~/.local/bin")
fi

# uv нужен python-инструментам; rtk не зависит от uv
NEEDS_UV=0
for a in ${OPT_ACTIONS[@]+"${OPT_ACTIONS[@]}"}; do
  case "$a" in serena|graphify|headroom) NEEDS_UV=1 ;; esac
done
UV_DESC=""
if [ "$NEEDS_UV" = 1 ] && ! has uv; then
  if [ "$OS" = "Darwin" ]; then UV_DESC="uv - brew install uv"; else UV_DESC="uv - официальный инсталлер astral.sh (файлом)"; fi
  OPT_ACTIONS=("uv" "${OPT_ACTIONS[@]}")
  OPT_DESC=("$UV_DESC" "${OPT_DESC[@]}")
  warn "uv ${C_DIM}- нужен serena/graphify/headroom${C_R} - НЕ НАЙДЕН"
else
  ok "uv ${C_DIM}- питоньи инструменты (serena/graphify/headroom)${C_R}"
fi

# --- Что будет установлено ---

ACTIONS=()       # ключи шагов: brew | bun | node | openwiki
ACTIONS_DESC=()  # человекочитаемое описание шага

add_action() { ACTIONS+=("$1"); ACTIONS_DESC+=("$2"); }

if [ "$OS" = "Darwin" ] && ! has brew; then
  add_action "brew" "Homebrew - менеджер пакетов (официальный инсталлер)"
fi
if [ "$BUN_STATUS" != "ok" ]; then
  if [ "$OS" = "Darwin" ]; then
    add_action "bun" "bun - brew install bun"
  else
    add_action "bun" "bun - официальный инсталлер bun.sh"
  fi
fi
if [ "$NODE_STATUS" != "ok" ]; then
  if [ "$OS" = "Darwin" ]; then
    add_action "node" "node ≥ ${NODE_MIN_MAJOR} - brew install node"
  elif has apt-get && has sudo; then
    add_action "node" "node ≥ ${NODE_MIN_MAJOR} - NodeSource (apt)"
  fi
fi
if [ "$WIKI_STATUS" != "ok" ]; then
  add_action "openwiki" "openwiki (опциональный) - $(npm_global) openwiki"
fi

printf '\n'
if [ "${#ACTIONS[@]}" -eq 0 ] && [ "${#OPT_ACTIONS[@]}" -eq 0 ]; then
  ok "Все зависимости harness на месте - устанавливать нечего."
  line
  if [ "$CHECK_ONLY" = 0 ] && has bun; then
    if confirm_default_yes "Выполнить bun install (npm-зависимости воркспейса)?"; then
      say "bun install …"
      (cd "$ROOT" && bun install) || { miss "bun install завершился ошибкой."; exit 1; }
      ok "npm-зависимости воркспейса установлены."
    fi
  fi
  exit 0
fi

line
printf 'БУДЕТ УСТАНОВЛЕНО (%s):\n\n' "$OS_PRETTY"
i=0
for desc in ${ACTIONS_DESC[@]+"${ACTIONS_DESC[@]}"}; do
  i=$((i + 1))
  printf '  %d. %s\n' "$i" "$desc"
done
if [ "$NODE_STATUS" != "ok" ] && [ "$OS" = "Linux" ] && ! has apt-get; then
  printf '  %s- node ≥ %s: apt не найден, установите вручную (https://nodejs.org или nvm/fnm)%s\n' "$C_WARN" "$NODE_MIN_MAJOR" "$C_R"
fi
if [ "${#OPT_ACTIONS[@]}" -gt 0 ]; then
  printf '\n  опциональные инструменты консоли (отдельное подтверждение):\n'
  for desc in ${OPT_DESC[@]+"${OPT_DESC[@]}"}; do
    printf '  + %s\n' "$desc"
  done
fi
printf '\n'

if [ "$CHECK_ONLY" = 1 ]; then
  say "Режим --check: показан только статус, установка не выполняется."
  line
  exit 0
fi

if [ "${#ACTIONS[@]}" -gt 0 ]; then
  if ! confirm "Установить перечисленное выше?"; then
    say "Установка отменена пользователем."
    line
    exit 1
  fi
fi

# --- Установка ---

INSTALLED=()
MANUAL=()

run_step() { # $1 - заголовок; команда - списком аргументов
  local title="$1"; shift
  say "$title"
  printf '    %s$ %s%s\n' "$C_DIM" "$*" "$C_R"
  "$@"
}

fetch_installer() { # $1 - что скачиваем (для лога), $2 - URL, $3 - файл в TMP_DIR
  printf '    %s$ curl -fsSL %s -o %s%s\n' "$C_DIM" "$2" "$3" "$C_R"
  mkdir -p "$TMP_DIR"
  curl -fsSL "$2" -o "$3"
}

ensure_brew_path() { # brew в PATH после установки инсталлером
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

for step in ${ACTIONS[@]+"${ACTIONS[@]}"}; do
  case "$step" in
    brew)
      if fetch_installer "Homebrew" "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh" "$TMP_DIR/brew-install.sh" \
         && run_step "Установка Homebrew…" /bin/bash "$TMP_DIR/brew-install.sh"; then
        ensure_brew_path
        has brew && INSTALLED+=("Homebrew") || { miss "brew не появился в PATH после установки."; exit 1; }
      else
        miss "Не удалось установить Homebrew."
        exit 1
      fi
      ;;
    bun)
      if [ "$OS" = "Darwin" ]; then
        if run_step "Установка bun…" brew install bun; then
          INSTALLED+=("bun $(bun --version 2>/dev/null || echo '')")
        else
          miss "Не удалось установить bun (brew install bun)."
          exit 1
        fi
      else
        if fetch_installer "bun" "https://bun.sh/install" "$TMP_DIR/bun-install.sh" \
           && run_step "Установка bun (инсталлер bun.sh)…" bash "$TMP_DIR/bun-install.sh"; then
          export PATH="$HOME/.bun/bin:$PATH"
          has bun && INSTALLED+=("bun $(bun --version 2>/dev/null || echo '')") || {
            miss "bun установлен в ~/.bun/bin - перезапустите терминал или добавьте путь в PATH."
            exit 1
          }
        else
          miss "Не удалось установить bun (https://bun.sh/install)."
          exit 1
        fi
      fi
      ;;
    node)
      if [ "$OS" = "Darwin" ]; then
        if run_step "Установка node (последняя стабильная)…" brew install node; then
          INSTALLED+=("node $(node --version 2>/dev/null || echo '')")
        else
          miss "Не удалось установить node (brew install node)."
          exit 1
        fi
      else
        if fetch_installer "NodeSource" "https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x" "$TMP_DIR/nodesource-setup.sh" \
           && run_step "Подключение репозитория NodeSource (${NODE_MIN_MAJOR}.x)…" sudo -E bash "$TMP_DIR/nodesource-setup.sh" \
           && run_step "Установка nodejs…" sudo apt-get install -y nodejs; then
          INSTALLED+=("node $(node --version 2>/dev/null || echo '')")
        else
          miss "Не удалось установить node через NodeSource/apt."
          exit 1
        fi
      fi
      ;;
    openwiki)
      if ! has npm && [ "$PM" = "npm" ]; then
        warn "npm недоступен - openwiki пропущен."
        MANUAL+=("openwiki: $(npm_global) openwiki (после появления npm)")
        continue
      fi
      # shellcheck disable=SC2046
      if run_step "Установка openwiki (опциональный)…" $(npm_global_cmd) openwiki; then
        INSTALLED+=("openwiki")
      else
        warn "Не удалось установить openwiki - он опциональный, продолжаем."
        MANUAL+=("openwiki: $(npm_global) openwiki")
      fi
      ;;
  esac
done

# --- Опциональные инструменты консоли ---

if [ "${#OPT_ACTIONS[@]}" -gt 0 ]; then
  printf '\n'
  if confirm_default_yes "Установить недостающие опциональные инструменты консоли?"; then
    for step in ${OPT_ACTIONS[@]+"${OPT_ACTIONS[@]}"}; do
      case "$step" in
        uv)
          if [ "$OS" = "Darwin" ]; then
            if run_step "Установка uv…" brew install uv; then INSTALLED+=("uv"); else warn "uv не установлен."; fi
          else
            if fetch_installer "uv" "https://astral.sh/uv/install.sh" "$TMP_DIR/uv-install.sh" \
               && run_step "Установка uv (инсталлер astral.sh)…" bash "$TMP_DIR/uv-install.sh"; then
              export PATH="$HOME/.local/bin:$PATH"
              has uv && INSTALLED+=("uv") || warn "uv установлен в ~/.local/bin - перезапустите терминал."
            else
              warn "uv не установлен (https://astral.sh/uv)."
            fi
          fi
          ;;
        serena)
          if run_step "Установка serena…" uv tool install -p 3.13 serena-agent; then
            INSTALLED+=("serena")
            if [ ! -f .serena/project.yml ]; then
              if run_step "Инициализация serena (индекс символов)…" serena project index --ls typescript; then
                INSTALLED+=("serena: проект проиндексирован")
              else
                warn "serena index не удался (не блокирует)."
              fi
            fi
          else
            warn "serena не установлен."
            MANUAL+=("serena: uv tool install -p 3.13 serena-agent")
          fi
          ;;
        qmd)
          if ! has npm && [ "$PM" = "npm" ]; then
            MANUAL+=("qmd: $(npm_global) @tobilu/qmd (после появления npm)")
            continue
          fi
          # shellcheck disable=SC2046
          if run_step "Установка qmd…" $(npm_global_cmd) @tobilu/qmd; then
            INSTALLED+=("qmd")
          else
            warn "qmd не установлен."
            MANUAL+=("qmd: $(npm_global) @tobilu/qmd")
          fi
          ;;
        codegraph)
          if ! has npm && [ "$PM" = "npm" ]; then
            MANUAL+=("codegraph: $(npm_global) @colbymchenry/codegraph (после появления npm)")
            continue
          fi
          # shellcheck disable=SC2046
          if run_step "Установка codegraph…" $(npm_global_cmd) @colbymchenry/codegraph; then
            INSTALLED+=("codegraph")
            if [ ! -f .codegraph/codegraph.db ]; then
              if run_step "Инициализация codegraph (индекс проекта)…" codegraph init .; then
                INSTALLED+=("codegraph: проект проиндексирован")
              else
                warn "codegraph init не удался (не блокирует)."
              fi
            fi
          else
            warn "codegraph не установлен."
            MANUAL+=("codegraph: $(npm_global) @colbymchenry/codegraph")
          fi
          ;;
        graphify)
          if run_step "Установка graphify…" uv tool install graphifyy; then
            INSTALLED+=("graphify")
            if [ ! -f graphify-out/graph.json ]; then
              # --code-only: локальный AST без LLM-ключа (доки пропускаются)
              if run_step "Инициализация graphify (граф кода)…" graphify extract . --code-only; then
                INSTALLED+=("graphify: граф построен (code-only)")
              else
                warn "graphify extract не удался (не блокирует)."
              fi
            fi
          else
            warn "graphify не установлен (PyPI-пакет называется graphifyy)."
            MANUAL+=("graphify: uv tool install graphifyy")
          fi
          ;;
        rtk)
          if [ "$OS" = "Darwin" ]; then
            if run_step "Установка rtk…" brew install rtk; then
              INSTALLED+=("rtk")
            else
              warn "rtk не установлен."
              MANUAL+=("rtk: brew install rtk")
            fi
          else
            if fetch_installer "rtk" "https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh" "$TMP_DIR/rtk-install.sh" \
               && run_step "Установка rtk (инсталлер rtk-ai)…" bash "$TMP_DIR/rtk-install.sh"; then
              export PATH="$HOME/.local/bin:$PATH"
              has rtk && INSTALLED+=("rtk") || warn "rtk установлен в ~/.local/bin - перезапустите терминал."
            else
              warn "rtk не установлен."
              MANUAL+=("rtk: https://github.com/rtk-ai/rtk#установка")
            fi
          fi
          ;;
        headroom)
          if run_step "Установка headroom…" uv tool install --python 3.13 "headroom-ai[all]"; then
            INSTALLED+=("headroom")
          else
            warn "headroom не установлен."
            MANUAL+=("headroom: uv tool install --python 3.13 \"headroom-ai[all]\"")
          fi
          ;;
        nx)
          if ! has npm && [ "$PM" = "npm" ]; then
            MANUAL+=("nx: $(npm_global) nx (после появления npm)")
            continue
          fi
          # shellcheck disable=SC2046
          if run_step "Установка nx…" $(npm_global_cmd) nx; then
            INSTALLED+=("nx")
          else
            warn "nx не установлен."
            MANUAL+=("nx: $(npm_global) nx")
          fi
          ;;
        agentplane)
          if ! has npm && [ "$PM" = "npm" ]; then
            MANUAL+=("agentplane: $(npm_global) agentplane (после появления npm)")
            continue
          fi
          # shellcheck disable=SC2046
          if run_step "Установка agentplane…" $(npm_global_cmd) agentplane; then
            INSTALLED+=("agentplane")
          else
            warn "agentplane не установлен; Harness продолжит со встроенным task adapter."
            MANUAL+=("agentplane: $(npm_global) agentplane")
          fi
          ;;
        codeburn)
          if ! has npm && [ "$PM" = "npm" ]; then
            MANUAL+=("codeburn: $(npm_global) codeburn (после появления npm)")
            continue
          fi
          # shellcheck disable=SC2046
          if run_step "Установка codeburn…" $(npm_global_cmd) codeburn; then
            INSTALLED+=("codeburn")
          else
            warn "codeburn не установлен; отчёт CodeBurn (вкладка Оптимизация) недоступен."
            MANUAL+=("codeburn: $(npm_global) codeburn")
          fi
          ;;
        open-design)
          if [ "$OS" != "Darwin" ]; then
            MANUAL+=("open-design: desktop-приложение с open-design.ai (Linux - сборка из исходников, README проекта)")
            continue
          fi
          # Версия зафиксирована; при новом релизе обновите OD_VERSION.
          OD_VERSION="0.24.1"
          case "$(uname -m)" in arm64) OD_ARCH="arm64" ;; *) OD_ARCH="x64" ;; esac
          OD_DMG="open-design-${OD_VERSION}-mac-${OD_ARCH}.dmg"
          OD_URL="https://github.com/nexu-io/open-design/releases/download/open-design-v${OD_VERSION}/${OD_DMG}"
          OD_MNT="$TMP_DIR/od-mnt"
          mkdir -p "$OD_MNT"
          if fetch_installer "open-design" "$OD_URL" "$TMP_DIR/$OD_DMG" \
             && run_step "Монтирование образа Open Design…" hdiutil attach -nobrowse -readonly -mountpoint "$OD_MNT" "$TMP_DIR/$OD_DMG" \
             && run_step "Копирование Open Design.app в /Applications…" ditto "$OD_MNT/Open Design.app" "/Applications/Open Design.app" \
             && run_step "Отключение образа…" hdiutil detach "$OD_MNT"; then
            mkdir -p "$HOME/.local/bin"
            if printf '#!/bin/sh\n# od CLI из состава Open Design (desktop-приложение)\nexec node "/Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs" "$@"\n' > "$HOME/.local/bin/od" \
               && chmod +x "$HOME/.local/bin/od"; then
              INSTALLED+=("open-design")
              INSTALLED+=("open-design: od в ~/.local/bin; MCP подключается через od mcp --daemon-url")
            else
              warn "open-design установлен, обёртка od не создана."
              MANUAL+=("open-design: od CLI - \"/Applications/Open Design.app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs\"")
            fi
          else
            warn "open-design не установлен."
            MANUAL+=("open-design: приложение с open-design.ai или GitHub Releases (nexu-io/open-design)")
          fi
          ;;
      esac
    done
  else
    say "Опциональные инструменты пропущены (пер-runtime настройка - Настройки → Инструменты в консоли)."
  fi
fi

# --- npm-зависимости воркспейса ---

printf '\n'
if has bun; then
  if confirm_default_yes "Выполнить bun install (npm-зависимости воркспейса)?"; then
    say "bun install …"
    if (cd "$ROOT" && bun install); then
      INSTALLED+=("npm-зависимости воркспейса (bun install)")
    else
      miss "bun install завершился ошибкой."
      exit 1
    fi
  fi
else
  warn "bun недоступен - bun install пропущен (запустите его вручную позже)."
fi

# --- Сводка ---

printf '\n'
line
printf 'ИТОГ\n'
line
if [ "${#INSTALLED[@]}" -gt 0 ]; then
  ok "Установлено:"
  for item in ${INSTALLED[@]+"${INSTALLED[@]}"}; do printf '      - %s\n' "$item"; done
else
  say "Ничего не установлено."
fi
if [ "${#MANUAL[@]}" -gt 0 ]; then
  warn "Требует действий вручную:"
  for item in ${MANUAL[@]+"${MANUAL[@]}"}; do printf '      - %s\n' "$item"; done
fi
if printf '%s' "${INSTALLED[*]:-}" | grep -q openwiki; then
  hint "openwiki: при первом запуске CLI запросит LLM-ключ (Node ≥ ${NODE_MIN_MAJOR})."
fi
if [ "${#OPT_ACTIONS[@]}" -gt 0 ]; then
  hint "Per-runtime настройка инструментов (graphify install / rtk init / headroom wrap) -"
  hint "раздел \"Настройки → Инструменты\" в консоли: bun run console."
fi
line
say "Готово. Запуск консоли: bun run console (подробнее - apps/console/README.md)."
