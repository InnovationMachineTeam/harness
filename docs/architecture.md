# Архитектура Agentic OS Console

Консоль - Next.js-приложение в bun-workspace (`apps/console`), управляющее шестью рантаймами агентов harness. Этот документ описывает слои, контракты и сквозные механизмы; детали фич - в профильных документах (см. [README](README.md)).

## Стек

| Слой | Технология |
|---|---|
| Раннер/менеджер пакетов | Bun (workspaces: `apps/*`) |
| Фреймворк | Next.js 15, App Router, RSC |
| UI | React 19, Tailwind CSS v4 |
| Markdown-рендер | react-markdown + remark-gfm (доки и вики во вкладке "Память") |
| Клиентское состояние | zustand (+persist в localStorage для UI-настроек) |
| Серверные зависимости | только `node:*` (child_process, fs, os, path) |

Рантайм-зависимости: next/react/zustand + react-markdown/remark-gfm; вся работа с системой - через модули ядра.

## Слои и потоки данных

```
┌─────────────────────────── Клиент ───────────────────────────┐
│  Страницы (/ /skills /mcp /plugins /workspaces /memory /settings) │
│  Компоненты (Dashboard, RuntimeSpace, memory/*, модалки)     │
│  zustand-стор: defaultRuntime, taskRuntimes, useGlobal,      │
│               runtimes[], tabCache, windowKey/autoRefresh    │
└───────────────┬──────────────────────────────────────────────┘
                │ fetch (RSC payload / JSON API / SSE)
┌───────────────▼───────────────── Сервер ─────────────────────┐
│  API-роуты (src/app/api/**)  ← кеш дашборда (TTL+дедуп)      │
│  Ядро (src/core): registry · state · mcp/sync · processes ·  │
│    skills · skillsSh/Find/Remove · installJobs · prompts ·   │
│    plugins · issues · cache · activity · sessions/* · memory │
│  Хелперы (src/lib): fs-сигналы · ps-сканер · toml · format   │
├──────────────────────────────────────────────────────────────┤
│  Адаптеры рантаймов (src/runtimes/*.ts × 6)                  │
└───────┬──────────────────┬──────────────────┬────────────────┘
        │                  │                  │
   ФС/mtime           ps/сигналы         headless-CLI
   (сессии, конфиги)  (процессы, kill)   (claude/codex/zcode/
                                        kimi/opencode + bunx skills)
```

Ключевые инварианты:

- **Источник правды о списке рантаймов** - `.agents/runtime/<vendor>/config.json` (см. [runtimes.md](runtimes.md)); консоль только читает эти конфиги.
- **Состояние консоли** - `.agents/console/state.json`; локальный файл, вне Git (содержит пути этой машины). Мутации всегда идут по схеме "сначала файл (атомарно, tmp+rename), потом ответ клиенту, потом клиентский стор" (см. ниже).
- **UI-плагины рантаймов** (`src/plugins/runtimes/`) - только оформление (монограммы/цвета); данные всегда приходят с сервера.

## Реестр API

| Роут | Назначение |
|---|---|
| `GET /api/runtimes?window=` | Срез статусов всех рантаймов (кеш 5 с) |
| `PATCH /api/runtimes` | Выбрать рантайм по умолчанию (★) |
| `GET /api/runtimes/list` | Лёгкий перечень рантаймов без проба (для стора) |
| `GET/POST/PATCH/DELETE /api/mcp` | MCP-реестр + прогон синка; PATCH принимает `enabled`, `runtimeOverride` и `transport` (правка настроек сервера, http - с `headers`) |
| `GET /api/mcp/catalog` | Пресет-каталог MCP (+ serena/qmd/codegraph; npx-пресеты адаптируются под выбранный менеджер bun/npm) |
| `GET/PATCH /api/skills` | Навыки рантайма + тогглы (useGlobal/default/runtime) |
| `GET /api/skills/installed` | Установленные harness-навыки со значениями по умолчанию |
| `POST /api/skills/create` | Создание навыка через headless-сессию рантайма |
| `POST /api/skills/remove` | Удаление навыка (`bunx skills remove -y` + фолбэк) |
| `GET /api/skills-sh/search` | Поиск skills.sh: CLI `find` + HTTP-фолбэк |
| `GET /api/skills-sh/detail` | Описание (реестр→страница→GitHub→DeepWiki) и аудит |
| `POST /api/skills-sh/install` | Запустить `bunx skills add -y` (job) |
| `GET /api/skills-sh/install?jobId=` | SSE-стрим вывода установки |
| `POST /api/skills-sh/install/input` | Ввод в stdin установки |
| `GET /api/plugins` | Установленные плагины + каталоги marketplace |
| `POST/PATCH/DELETE /api/plugins` | Установить / вкл-выкл / удалить плагин (+синк) |
| `POST/DELETE /api/plugins/marketplace` | Добавить/убрать marketplace |
| `GET /api/processes?runtime=` | Процессы рантайма (uptime/cpu/mem/kind) |
| `POST /api/processes/action` | stop (SIGTERM→SIGKILL) / restart (только .app) |
| `GET /api/sessions?runtime=&dir=&id=` | Список сессий / детали-превью |
| `POST /api/sessions/reply` | Headless-ответ в сессию (resume) |
| `POST /api/prompts/run` | Промт в новой сессии (рантайм задачи/★) |
| `GET/PUT /api/settings` | Рантаймы под задачи (promptExecution/skillCreation) |
| `GET/PUT /api/tools` | Статусы инструментов экономии контекста (+обновление tools.env, ленивый autostart) / выбор менеджера bun-npm |
| `POST /api/tools/action` | Жизненный цикл: install/uninstall/reinstall/toggle (+`dryRun` - превью команд) |
| `POST /api/tools/diagnose` | Диагностика инструмента + промпт headless-исправления |
| `POST /api/tools/dashboard` | Автономный инстанс дашборда: start/stop; тоггл autostart |
| `GET /api/tools/job?jobId=` | SSE-стрим job'а установки инструмента (файловый лог) |
| `POST /api/tools/job/input` | Ввод в stdin job'а (интерактивные установщики) |
| `GET /api/tools/usage` | События tools-usage.json + внешние метрики (CLI/файлы) |
| `GET/PUT /api/workspaces` | Рабочие папки (обязательная + дополнительные + openwiki + graphify) |
| `GET/POST /api/workspaces/clone` | Локальные проекты `sources/`: список / `git clone` по https-ссылке (job, SSRF-фильтр хоста) |
| `GET /dashboard/*` | Embed-прокси дашборда Headroom (снимает x-frame-options; апстрим - литеральный 127.0.0.1:8787, GET) |
| `GET /api/memory/docs` | Деревья markdown-документов рабочих папок (вкладка Docs) |
| `GET /api/memory/openwiki` | Статус вики по папкам: дерево, last-update, сборка, CLI |
| `POST /api/memory/openwiki/build` | Запуск `openwiki --init/--update` в папке (отвязанный процесс) |
| `GET /api/memory/graphify` | Статус графа Graphify по папкам (+публикация graph.html) |
| `POST /api/memory/graphify/build` | Запуск `graphify extract/update .` в папке (отвязанный процесс) |
| `POST /api/memory/graphify/graph` | Публикация graph.html в public/graphify/<slug> (iframe) |
| `GET /api/memory/runtimes?runtime=` | Memory-файлы рантаймов (все или один - вкладка рантайма) |
| `GET /api/memory/file?path=` | Чтение файла из разрешённых корней памяти (allowlist) |
| `POST /api/memory/openwiki/visualizer` | Экспорт статического визуализатора + публикация в public/visualizers (без LLM) |

## Состояние консоли (`.agents/console/state.json`)

Локальное машинное состояние консоли: вне Git (`.gitignore` игнорирует `.agents/console/` целиком, пути в файле принадлежат этой машине). Отсутствующий или повреждённый файл не ошибка - консоль стартует со значений по умолчанию.

```jsonc
{
  "mcp": { "servers": { "<name>": { "transport", "enabled", "runtimeOverrides" } } },
  "skills": { "useGlobal": true, "defaults": {}, "runtimeOverrides": {} },
  "defaultRuntime": "claude",            // ★ - для промптов, если у задачи не назначен рантайм
  "settings": { "taskRuntimes": { "promptExecution": null, "skillCreation": null } },
  "plugins": { "installed": {}, "marketplaces": [] },
  "workspaces": { "mandatory": "<путь>", "additional": [], "openwiki": [], "graphify": [] },
  "tools": { "installed": { "<id>": { "runtimes", "params", "at", "enabled" } } },
  "lastMcpSync": { "<target>": { "ok", "applied", "removed", "error" } }
}
```

- Запись атомарная: `state.json.tmp` + rename; чтение - с merge на значения по умолчанию (частичный или повреждённый файл не останавливает консоль).
- Пути рабочих папок можно задавать через `~`/`~/…` - при загрузке и валидации они разворачиваются в домашний каталог (`expandHome` в `core/state.ts`), в состоянии и дальше по коду ходят только абсолютные пути.
- `workspaces.openwiki` - подмножество списка папок (тогглы вики OpenWiki); посторонние и убранные из списка пути отбрасываются молча при валидации.
- Рядом со state хранятся служебные файлы консоли (не state, отдельные форматы): `package-manager.json` (выбор Bun/NPM, пишет и setup.sh), `tools.env` (плоское состояние для диспетчера `tooling/scripts/tool.sh`), `tools-usage.json` (события и метрики), `dashboards.json` (pid автономных дашбордов Serena/Headroom), `tool-jobs/<id>.log|.json` (вывод и статус установочных job'ов - SSE читает файлы, инвариантно к HMR), `logs/<id>-dashboard.log` - [tools.md](tools.md)).
- Любой мутирующий роут: мутация → `saveState()` → ответ → клиент обновляет стор. Клиентский стор никогда не опережает файл.
- Все мутации вызывают `invalidateDashboardCache()`.

## Производительность

| Механизм | Что делает | Эффект |
|---|---|---|
| Микрокеш дашборда (`core/cache.ts`) | TTL 5 с + дедуп параллельных пересчётов; инвалидация мутациями | Повторные открытия `/` мгновенны; опрос 10 с держит кеш тёплым |
| Only-проб space | `/runtime/[id]` пробит один рантайм, не все шесть | Страница рантайма 1.7-2.5 с → ~0.05 с |
| ps-снапшот (`lib/signals/processes`) | Один `ps` на цикл проба (TTL 2 с), fresh-срез перед сигналами процессам | Вместо ~12 спавнов на проб - 1 |
| `scanLimit` в обходах ФС | Потолок осмотренных файлов (гигантские каталоги ~/.cursor) | Холодный проб 0.8-2 с → ~0.2 с |
| `tabCache` в zustand-сторе | Данные вкладок (процессы/навыки/сессии) с TTL; при сбое - устаревший кеш | Переключение вкладок мгновенное |
| `loading.tsx` + streaming | Скелетон для серверных страниц | Навигация не "замирает" |

## Безопасность

- **SSRF-фильтр** для всех серверных fetch: только http/https, hostname из allowlist (`skills.sh`, `github.com`, `deepwiki.com`; marketplace - любые публичные хоста, но localhost/приватные/зарезервированные диапазоны запрещены), таймауты, лимит размера ответа.
- **Спавны процессов**: только литеральные команды (`bunx`, `claude`, `codex`, `kimi`, `opencode`, `node`, `open`, `sh`) с массивами аргументов; без оболочки; промпты санитизируются (NUL, длина, ведущий `-`); имена пакетов и MCP-серверов - строгие регексы. Обёрточные функции вокруг `spawn` не заводить: pre-commit сканер Mimosa блокирует их как инъекционные (паттерн - инлайн-switch с литералами, см. `core/prompts.ts`, `core/installJobs.ts`).
- **Чтение файлов памяти** (`GET /api/memory/file`): allowlist корней - только `*.md` внутри рабочих папок, недот-файлы внутри `<dir>/openwiki/` и memory-каталогов рантаймов, одиночные глобальные файлы (`~/.claude/CLAUDE.md`); realpath-контейн (symlink наружу запрещён), запрет скрытых компонент пути, потолок 1 МБ. Произвольные пути запрещены (`core/memory.ts#checkReadPath`).
- **Сборка OpenWiki**: спавн литеральной команды `openwiki --init|--update` (cwd = рабочая папка, без оболочки, пользовательский ввод не попадает); pid/режим - в `openwiki/.console-build.json`, лог - `openwiki/.console-build.log`.
- **Визуализатор**: экспорт - литеральная команда `openwiki visualize openwiki --export <dir>`; публикация - 5 файлов фиксированного набора копируются в `apps/console/public/visualizers/<slug>/` (slug - sha256 пути рабочей папки, каталог в .gitignore), Next отдаёт их статикой; динамических роутов с путями пользователя нет. `/api/memory/openwiki` пересинхронизирует и подчищает слаги.
- **Guard-политика репозитория** (AGENTS.md §3) не ослабляется: консоль пишет только в `.agents/console/`, MCP-конфиги (managed-имена) и не изменяет файлы навыков; `.gitignore` синхронизирован с запретами (секреты - вне git).
- Атомарные записи и `managed`-семантика MCP-синка - см. [mcp.md](mcp.md).
