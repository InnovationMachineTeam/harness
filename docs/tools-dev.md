# Разработка плагинов инструментов

Каждый инструмент экономии контекста (Serena, qmd, CodeGraph, Graphify, RTK, Headroom, OpenWiki) оформлен как **плагин** - самодостаточный модуль в `apps/console/src/core/tools/<id>.ts`, экспортирующий объект `ToolDef`. Реестр-агрегатор - `core/tools.ts`: собирает плагины в `TOOLS` и держит общую логику (детект CLI, состояние, tools.env, статусы). Гайд по использованию - [tools.md](tools.md); канонические правила - AGENTS.md §10.

## Структура плагина

```ts
// apps/console/src/core/tools/<id>.ts
import { globalInstallCommand, type ToolDef } from "../tools";

export const <id>Tool: ToolDef = {
  id: "<id>",                    // = имени MCP-сервера, если есть пресет
  title: "Название",
  description: "1-2 строки для карточки",
  docsUrl: "https://github.com/…",
  category: "code" | "graph" | "search" | "context",
  bin: "<cli>",                  // детект через which
  systemInstall: (pm, platform) => ["…"],  // bun add -g / npm i -g / uv / brew
  requires: { bin: "uv", installCommand: (platform) => [...] },  // опц.
  mcpPreset: (params) => transport | null,   // опц.: MCP-транспорт
  perRuntime: {                  // опц.: интеграция в рантаймы
    supported: ["claude", "codex", …],
    installCommand: (runtime, params) => ["…"],
    uninstallCommand: (runtime) => ["…"],
    markerFile: (runtime, home, repoRoot) => "путь" | ["пути"] | null,
    notes: { zcode: "почему не поддержан" },
    params: [{ key: "scope", label: "…" }],    // параметры модалки
    detachedInstall: false,        // true - шаг-сервис (headroom proxy)
  },
  hasModes: true,                 // опц.: Segmented режимов (headroom wrap/mcp)
  dashboardCommand: ["…"],        // опц.: автономный сервис (detached-шаг)
  uninstallStopsDashboard: true,  // опц.: uninstall останавливает сервис
  postInstallCommands: (state, params) => string[][],  // опц. (qmd: индексация)
  projectInit: {                  // опц.: инициализация проекта
    // Аргументы: dir - рабочая папка, repoRoot - корень репозитория консоли,
    // name - имя воркспейса папки (graphify: <repoRoot>/graphify/<name>).
    init: (dir, repoRoot, name) => [["<cli>", "init"]],        // кнопка + install; cwd = dir
    reinit: (dir, repoRoot, name) => [["<cli>", "index"]],     // опц.: пересборка поверх
    update: (dir, repoRoot, name) => [["<cli>", "sync", "-q"]],// husky pre-commit (быстро!)
    initMarker: (dir, repoRoot, name) => `${dir}/…`,           // признак "уже инициализирован"
  },
  dashboard: { url: "http://127.0.0.1:…", label: "Дашборд …" },
};
```

`projectInit.update` выполняется на **каждый коммит** (husky) - команды должны быть быстрыми и молча пропускаться, если инициализации не было (скрипт проверяет `initMarker`-артефакт). Медленная инициализация - только в `init`.

### Ключевые поля

- **`systemInstall`** - глобальная установка пакета. npm-пакеты обязаны учитывать менеджер (`globalInstallCommand(pm, pkg)` из `../tools` - выбор Bun/NPM из setup.sh). Верните `null`, если на платформе ставится вручную.
- **`perRuntime`** - интеграция в рантаймы. `installCommand`/`uninstallCommand` возвращают **литеральные массивы аргументов** (spawn без оболочки - guard и Mimosa следят). Неподдерживаемые рантаймы не попадают в `supported`, а объясняются в `notes`. `markerFile` - детект внешних установок; для project/global-вариантов возвращайте массив путей.
- **`detachedInstall` + `dashboardCommand`** - для сервисов: шаг выполняется detached и не ждёт завершения (headroom proxy). Uninstall такого инструмента обязан ставить `uninstallStopsDashboard: true` - консоль остановит сервис и сбросит autostart.
- **Сложная зачистка** (CLI не умеет uninstall - как RTK project): реализуйте программную очистку в `cleanupAfterUninstall` (`core/toolActions.ts`) - только с boundary-проверкой `path.resolve(root, rel)`.

## Чек-лист нового плагина (та же серия коммитов)

1. `core/tools/<id>.ts` - ToolDef (+ private-хелперы файла).
2. Регистрация в `TOOLS` (`core/tools.ts`) - одна строка.
3. `tooling/scripts/tool.sh` - строка в `TOOL_SPECS` + case в exec-свитче.
4. `tooling/scripts/setup.sh` - opt_status + case установки.
5. `docs/tools.md` - строка карты интеграций и unsupported-матрицы.
6. `AGENTS.md` §10 - строки таблиц (инструменты скрипта + экономия контекста).
7. Тест `core/__tests__/tools.test.ts`: install/uninstall-команды, матрица.
8. Если инструмент с MCP - пресет в `core/plugins.ts` (MCP_PRESETS).
9. Если у CLI нет стабильного `--version` - НЕ добавляйте его в `toolVersion` (spawn-allowlist), детекция останется по `which`.

## Диагностика (автоматическая)

`core/toolDiagnostics.ts` строит проверки из самого ToolDef - писать что-то отдельно не нужно: CLI, зависимости, per-runtime маркеры, MCP-реестр, доступность дашборда (TCP-проба), состояние консоли. Провалы собираются в промпт headless-исправления (кнопка "Исправить" → `/api/prompts/run`). Если инструменту нужна специфичная проверка - добавьте её в `runToolDiagnostics` рядом с остальными, формат `{name, ok, detail, critical}`.

## Ограничения безопасности

- Никаких оболочек: только массивы аргументов; пути - с boundary-проверкой (`path.resolve(root, rel)` + `startsWith(root + sep)`).
- Имена файлов job'ов - литеральные константы; пользовательские строки не попадают в пути (path-traversal).
- Сервер не делает HTTP-запросов на loopback - доступность дашбордов только TCP-пробой, страницы грузит браузер.
- MCP-имена - `isValidMcpName`; transport-конфиги - через `parseTransport`.
