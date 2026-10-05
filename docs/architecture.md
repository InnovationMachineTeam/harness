# Архитектура Harness Console

Консоль - Next.js-приложение в bun-workspace (`apps/console`), управляющее шестью рантаймами агентов harness. Этот документ описывает слои, контракты и сквозные механизмы; детали фич - в профильных документах (см. [README](README.md)).

## Стек

| Слой | Технология |
|---|---|
| Раннер/менеджер пакетов | Bun (workspaces: `apps/*`) |
| Фреймворк | Next.js 16, App Router, RSC |
| UI | React 19, Tailwind CSS v4 |
| Markdown-рендер | react-markdown + remark-gfm (доки и вики в разделе "Знание") |
| Клиентское состояние | zustand (+persist в localStorage для UI-настроек) |
| Workflow | LangGraph.js, SQLite checkpointer, отдельный Bun worker |
| Визуализация графа | React Flow (`@xyflow/react`) |
| Серверная инфраструктура | `node:*`, `better-sqlite3`, YAML и Zod-контракты |

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
│  Ядро (src/core): registry · state · mcp/sync · mcp/client · │
│    agentTools · agentLoop · processes · skills ·             │
│    skillsSh/Find/Remove · installJobs · prompts ·            │
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
- **Workflow-run неизменяем по конфигурации**: при старте сохраняется разрешённый YAML, содержимое использованных ролей и их internal skills, модели и хэши runtime-конфигов. Worker выполняет snapshot, а не перечитывает изменившийся каталог.
- **Долгоживущая оркестрация**: Next.js только принимает команды и отдаёт SSE. Отдельный worker удерживает lease, пишет checkpoints и восстанавливает незавершённый run после аварии.

Подробные контракты шага с секциями контроля, failover, partial run, interrupts, ETag и хранения описаны в [workflows.md](workflows.md). Роли находятся в [roles.md](roles.md), ledger и стоимость в [stats.md](stats.md).

## Реестр API

| Роут | Назначение |
|---|---|
| `GET /api/runtimes?window=` | Срез статусов всех рантаймов (кеш 5 с) |
| `PATCH /api/runtimes` | Выбрать рантайм по умолчанию (★) |
| `GET /api/runtimes/list` | Лёгкий перечень рантаймов без проба (для стора) |
| `GET /api/guardrails` | Актуальный снимок правил, покрытия, policy digest и точек интеграции для вкладки аудитора |
| `POST /api/guardrails` | Фиксированные действия аудитора: `check`, `test`, `generate`; произвольные команды не принимаются |
| `GET/POST/PATCH/DELETE /api/mcp` | MCP-реестр (GET отдаёт `label` происхождения: tool/plugin/preset/manual) + прогон синка; PATCH принимает `enabled`, `runtimeOverride`, `transport` и `hooks` (правка настроек сервера, http - с `headers`); хуки жизненного цикла (install/enable/disable/remove) исполняются `core/lifecycleHooks.ts` после guard-проверки, cwd - обязательная рабочая папка, ошибки - `hookErrors` |
| `GET /api/mcp/catalog` | Пресет-каталог MCP (+ serena/qmd/codegraph; npx-пресеты адаптируются под выбранный менеджер bun/npm) |
| `GET/PATCH /api/skills` | Навыки рантайма + тогглы (useGlobal/default/runtime); PATCH выполняет хуки навыка для рантаймов с изменившимся effective (симлинк в обязательной папке + команды манифеста после guard-проверки; ошибки - `hookErrors` в ответе) |
| `GET /api/skills/all` | Единый список навыков всех источников с лейблами (internal/runtime/skills.sh/plugin/workflow), бейджами рантаймов (installed/effective), тогглами и хуками манифеста (`core/skillRegistry.ts`); симлинк-детекция - в обязательной рабочей папке |
| `GET /api/skills/installed` | Установленные harness-навыки со значениями по умолчанию |
| `POST /api/skills/create` | Создание навыка через headless-сессию рантайма или провайдера задачи (`provider:<id>`) |
| `POST /api/skills/remove` | Удаление навыка (`bunx skills remove -y` + фолбэк) |
| `GET /api/skills-sh/search` | Поиск skills.sh: CLI `find` + HTTP-фолбэк |
| `GET /api/skills-sh/detail` | Описание (реестр→страница→GitHub→DeepWiki) и аудит |
| `POST /api/skills-sh/install` | Запустить `bunx skills add -y` (job) |
| `GET /api/skills-sh/install?jobId=` | SSE-стрим вывода установки |
| `POST /api/skills-sh/install/input` | Ввод в stdin установки |
| `GET /api/plugins` | Установленные плагины + каталоги marketplace |
| `POST/PATCH/DELETE /api/plugins` | Установить / вкл-выкл / удалить плагин (+синк); хуки плагина (install/enable/disable/remove) - `core/lifecycleHooks.ts`, cwd - обязательная рабочая папка, ошибки - `hookErrors` |
| `POST/DELETE /api/plugins/marketplace` | Добавить/убрать marketplace |
| `GET /api/processes?runtime=` | Процессы рантайма (uptime/cpu/mem/kind) |
| `POST /api/processes/action` | stop (SIGTERM→SIGKILL) / restart (только .app) |
| `GET /api/sessions?runtime=&dir=&id=` | Список сессий / детали-превью; `runtime` - один рантайм или список через запятую, без параметра - объединённый список всех рантаймов с историей (сортировка по свежести, лимит 500); `id` - только при одном рантайме |
| `POST /api/sessions/reply` | Headless-ответ в сессию (resume) |
| `POST /api/prompts/run` | Промт в новой сессии (рантайм задачи/★) или провайдеру задачи (`provider:<id>`, in-process запрос, ответ в лог runs) |
| `GET /api/optimization` | Состояние оптимизации: отчёты Claude Insights и CodeBurn, время последних запусков, разрешённый исполнитель и готовность `readiness` (claudeInstalled - детект адаптера Claude Code; codeburnInstalled/codeburnEnabled - CLI и запись инструмента CodeBurn) |
| `POST /api/optimization/report` | Сформировать отчёт рекомендаций: сводка статистики за 30 дней (`core/optimization.ts`: usage_receipts, индекс сессий, каталог цен) уходит провайдеру синхронным запросом (до 5 мин), JSON-ответ сохраняется в `settings.optimization.reports` |
| `POST /api/optimization/run` | Запуск оптимизации: промпт из выбранных рекомендаций (`ids`) уходит исполнителю задачи "Оптимизация" (headless-рантайм или `provider:<id>`); при успехе фиксируется `settings.optimization.lastOptimizedAt`; задача видна в "Мониторинг → Задачи" |
| `GET /api/design/workspace?dir=` | Дизайн-контекст рабочей папки: статус пакета (DESIGN.md, ui-kit, components), managed-блоков CLAUDE.md/AGENTS.md, дизайн-MCP, design router ([design.md](design.md)) |
| `POST /api/design/workspace` | Действия пакета и синка: init из пресета themes/, save-design, save-uikit, scan-components, save-components, sync/desync managed-блоков; dir - только рабочие папки консоли |
| `POST /api/design/run` | Дизайн-задача единым интерфейсом: runtime (headless claude/opencode/... с cwd = папка), provider (агентный цикл с MCP open-design/figma) или session (headless-resume) - `core/design/run.ts` |
| `POST /api/design/artifacts` | Артефакты open-design: список инструментов MCP-сервера и вызов list-инструмента (только чтение) |
| `POST /api/agent/chat` | Диалог вкладки "Агент" (раздел /agent): UIMessage-стрим. Обе ветки исполняются как LangGraph-граф (`core/agent/chatGraph.ts`, стрим в части UI - `core/agent/chatStream.ts`). Провайдер - граф "model"-"tools": LangChain-модель по kind пресета (`core/langchain/chatModel.ts`: openai → ChatOpenAI с базовым URL из записи, anthropic → ChatAnthropic, gemini → ChatGoogleGenerativeAI; effort → `reasoning_effort` онлайн openai-совместимым), json-render спека из ```spec-блоков через `createJsonRenderTransform`; инструменты - встроенные `read_file`/`list_dir`/`run_command` (`core/agentTools.ts`, лимит 10 шагов модели) и MCP-серверы реестра (`core/mcp/client.ts`); рантайм - узел графа запускает `launchPromptRun` (cwd/model/effort) и стримит лог-файл, пока жив процесс. Перед запуском последняя реплика разбирается на slash-команды (`core/workflows/skills.ts`): `/master:<id>` и `/agent:<id>` раскрываются (рантайм - блоки в промте; провайдер - роль и навыки в системный промт), `@путь` у провайдера разворачивается в содержимое файлов, у рантайма остаётся токеном; секреты (.env*, *.pem, *.key, *id_rsa*, secrets/) не читаются; недоверенное содержимое оборачивается блоками UNTRUSTED; ошибка раскрытия - HTTP 400; токен `/workflow:` в чате отклоняется (запускается клиентом). Путь провайдера дополнительно проверяется `providerBaseUrlError` (запрет приватных адресов онлайн-провайдеров); агентный цикл ограничен 50 вызовами инструментов и 32 KB вывода инструмента в контексте. Каждый запуск - задача в реестре |
| `GET /api/slash-menu?executor=&workflowId=&workspace=` | Данные меню slash-команд вкладки "Агент": навыки исполнителя и общие (нативный вызов), master skills мастер-каталога по привязке и тогглу исполнителя (`/master:<id>`), роли (`/agent:<id>`, direct-режим), каталог workflow (`/workflow:<id>`, direct-режим), навыки ролей выбранного workflow (режим workflow) |
| `GET /api/workspace-files?cwd=&path=&q=` | Файлы и папки рабочей папки для @-упоминаний: без `q` - один уровень (`path` - подпапка), с `q` - рекурсивный поиск по подстроке (лимиты 500 записей / 200 находок; служебные каталоги исключены) |
| `GET/POST /api/direct-chats` | Локальная история Direct-чатов вкладки "Агент": GET без `id` - список (id, title, updatedAt, messageCount), с `id` - чат с сообщениями и временем реплик; POST `{id?, messages, times?}` - создать/перезаписать. Хранение - `.agents/console/direct/<id>/` (chat.json + пустые input/ и output/ под будущую передачу файлов; каталог исключён из git) - `core/directChats.ts` |
| `GET /api/git/status?dir=` | Статус git рабочей папки: бинарник, репозиторий, текущая ветка, список локальных веток (`core/git.ts`) |
| `POST /api/git/init` | `git init` в рабочей папке (кнопка "✕ Git" селектора веток) |
| `POST /api/git/branch` | Ветка рабочей папки: `create: true` (по умолчанию) - `git checkout -b`, `create: false` - переключение на существующую; имя проверяет `git check-ref-format` |
| `GET/PUT /api/settings` | Рантаймы под задачи (promptExecution/skillCreation/optimization; значения - id рантайма или `provider:<id>` активного провайдера; для optimization null - провайдер по умолчанию, Ollama), провайдер AI SDK по умолчанию (`defaultProvider`, null - Ollama), последний выбор исполнителя вкладки "Агент" (`agentExecutor`: "provider", `provider:<id>` или id рантайма; восстанавливается при загрузке) и лимит истории direct-чата (`agentHistoryLimit`: целое 0..500, сколько последних реплик уходит модели; null - 20, 0 - без ограничения) |
| `GET /api/providers` | Реестр LLM-провайдеров: пресеты, записи, статусы (empty/filled/error/active), интеграции, задачи ([providers.md](providers.md)) |
| `PUT /api/providers` | Сохранить настройки провайдера в `.agents/providers/<id>/` (`apiKey, baseUrl, models, authScope?` - settings.json + key.env; изменение сбрасывает проверку) |
| `POST /api/providers` | Действия: `verify` (проверка соединения; для OAuth-провайдеров - обмен ключа на токен в `core/providerAuth.ts`), `upload-cert`/`remove-cert` (сертификат CA, стандартное имя `ca.pem` в папке провайдера), `export-langgraph` (.env; только статические ключи), `clear` |
| `GET /api/providers/usage` | Статистика токенов: записи четырёх источников (вызовы консоли, диалог вкладки "Агент", транскрипты рантаймов, ledger'ы graphify/headroom), итоги по провайдерам/моделям, счётчики по дням; сбор внешних источников ленивый (TTL 5 мин) - `core/providerUsage.ts`, `core/usage/*` |
| `GET/PUT /api/tools` | Статусы инструментов экономии контекста (+обновление tools.env, ленивый autostart) / выбор менеджера bun-npm |
| `POST /api/tools/action` | Жизненный цикл: install/uninstall/reinstall/toggle (+`dryRun` - превью команд); хуки ToolDef (install/enable/disable/remove) - `core/lifecycleHooks.ts`, cwd - обязательная рабочая папка |
| `POST /api/tools/diagnose` | Диагностика инструмента + промпт headless-исправления |
| `POST /api/tools/dashboard` | Автономный инстанс дашборда: start/stop; тоггл autostart |
| `GET /api/tools/job?jobId=` | SSE-стрим job'а установки инструмента (файловый лог); завершающий кадр `{ done, exitCode, results? }` несёт итоги шагов (stepId/exitCode) |
| `POST /api/tools/job/input` | Ввод в stdin job'а (интерактивные установщики) |
| `GET /api/tools/usage` | События tools-usage.json + внешние метрики (CLI/файлы) |
| `GET/POST /api/update` | Реестр зависимостей (вкладка "Обновить"): GET - синхронизация без сети (новые инструменты добавляются, удалённые удаляются), POST - полная проверка свежих версий (реестры npm и PyPI, GitHub releases, brew outdated) с записью даты проверки |
| `POST /api/update/run` | Обновление выбранных записей реестра: `{ ids }` → job (stepId = id записи, шаги optional); по завершении статусы и время пишутся в `updates.json` |
| `GET /api/pricing` | Каталог цен (`.agents/pricing/`, формат в [pricing.md](pricing.md)): подписки вендоров и провайдеров, API-цены моделей со средними, статусы зафиксированных источников |
| `POST /api/pricing/refresh` | Обновление цен из зафиксированных источников: json-источники обновляют `models.json`, html - проверка доступности; недоступный помечается `unavailable` |
| `GET/PUT /api/workspaces` | Рабочие папки (обязательная + дополнительные + openwiki + graphify) |
| `GET/POST /api/workspaces/clone` | Локальные проекты `sources/`: список / `git clone` по https-ссылке (job, SSRF-фильтр хоста) |
| `GET /dashboard/*` | Embed-прокси дашборда Headroom (снимает x-frame-options; апстрим - литеральный 127.0.0.1:8787, GET; в HTML инжектится fetch-shim - core/headroomEmbed.ts) |
| `GET/POST /headroom-api/*` | Прокси API дашборда Headroom (путь 1:1 на литеральный 127.0.0.1:8787; сюда fetch-shim направляет root-relative запросы данных из iframe) |
| `GET /api/memory/docs` | Деревья markdown-документов рабочих папок (вкладка Docs) |
| `GET /api/memory/openwiki` | Статус вики по папкам: дерево, last-update, сборка, CLI |
| `POST /api/memory/openwiki/build` | Запуск `openwiki --init/--update` в папке (отвязанный процесс) |
| `GET /api/memory/graphify` | Статус графов-воркспейсов Graphify по папкам (хранилище `graphify/<имя>/graphify-out`; +wiki с деревом статей, +авто-публикация graph.html в public/graphify/<slug>) |
| `POST /api/memory/graphify/build` | Запуск цепочки `graphify extract <папка> --out graphify/<имя> && graphify cluster-only <воркспейс> --no-label` (отвязанный процесс; graph.html создаёт cluster-only) |
| `POST /api/memory/graphify/wiki` | Запуск `graphify export wiki --graph <воркспейс>/graphify-out/graph.json` (отвязанный процесс; 409 при идущей сборке графа или wiki) |
| `POST /api/memory/graphify/graph` | Публикация graph.html в public/graphify/<slug> (iframe); prune - по слагам каталогов хранилища |
| `GET /api/memory/runtimes?runtime=` | Memory-файлы рантаймов (все или один - вкладка рантайма) |
| `GET /api/memory/file?path=` | Чтение файла из разрешённых корней памяти (allowlist) |
| `POST /api/memory/openwiki/visualizer` | Экспорт статического визуализатора + публикация в public/visualizers (без LLM) |
| `GET /api/monitoring/tasks` | Реестр задач консоли (промты, запросы провайдерам, сборки OpenWiki/Graphify), новые сверху; финализация running-задач при чтении (`core/tasks.ts`) |
| `GET /api/stats/heatmap?metric=tasks|tokens|cost&period=1w|1m|3m|6m|1y|all` | Использование harness по дням. `tasks` - каждая задача консоли - отсчёт, группировка по локальному дню и исполнителю (`runtime:<id>`, `provider:<id>`, `tool:<id>`) со статусами и типами задач; источник - меты задач `.agents/console/tasks` (`readTaskMetas`). `tokens`/`cost` - дневные суммы `usage_receipts` всех workspace-хранилищ; стоимость - зафиксированная плюс оценка по каталогу цен. Без `period` действует прежнее окно `?months=1-24` |
| `GET /api/memory/openwiki/workspaces` | Вики-воркспейсы openwiki: состав + активность по рабочим папкам (реестр `~/.openwiki/wiki-workspaces.json`) |
| `POST /api/memory/openwiki/workspaces` | Действия: `link` (создать из ≥2 папок с собранной вики), `use`/`clear` (активный воркспейс папки), `delete` |

## Состояние консоли (`.agents/console/state.json`)

Локальное машинное состояние консоли: вне Git (`.gitignore` игнорирует `.agents/console/` целиком, пути в файле принадлежат этой машине). Отсутствующий или повреждённый файл не ошибка - консоль стартует со значений по умолчанию.

```jsonc
{
  "mcp": { "servers": { "<name>": { "transport", "enabled", "runtimeOverrides" } } },
  "skills": { "useGlobal": true, "defaults": {}, "runtimeOverrides": {} },
  "defaultRuntime": "claude",            // ★ - для промптов, если у задачи не назначен рантайм
  "defaultProvider": "ollama",           // ★ провайдер AI SDK по умолчанию (вкладка "Агент"); null - Ollama
  "settings": {
    "taskRuntimes": { "promptExecution": null, "skillCreation": null, "optimization": null },  // значения: id рантайма или "provider:<id>"; optimization null - провайдер по умолчанию (Ollama)
    "agentExecutor": "provider",        // последний выбор исполнителя вкладки "Агент"; null - "provider"
    "agentHistoryLimit": null,          // реплик истории direct-чата модели; null - 20, 0 - без ограничения
    "optimization": {                   // вкладка "Оптимизация" (Claude Insights / CodeBurn)
      "reports": {                      // последний отчёт по каждому виду; null - не сформирован
        "claudeInsights": { "generatedAt": "...", "recommendations": [ { "id", "title", "detail", "impact?": "high|medium|low" } ] },
        "codeburn": null
      },
      "lastOptimizedAt": { "claudeInsights": null, "codeburn": null }
    },
    "billing": {                        // подписки и Pay as You Go (docs/pricing.md)
      "runtimes": { "<runtime-id>": { "mode": "none|plan|payg", "planId?": "id тарифа из subscriptions.json" } },
      "providers": { "<provider-id>": { "mode": "none|plan|payg" } },
      "deposits": { "runtime:<id>|provider:<id>": [ { "id", "amount", "currency", "at", "note?" } ] }
    }
  },
  "providers": {
    "entries": { "<preset-id>": { "apiKey", "baseUrl", "models", "verifiedAt", "verifyError", "verifyModels" } },
    "langgraphExport": { "providerId", "at" }
  },
  "plugins": { "installed": {}, "marketplaces": [] },
  "workspaces": { "mandatory": "<путь>", "additional": [], "openwiki": [], "graphify": [] },
  "tools": { "installed": { "<id>": { "runtimes", "params", "at", "enabled" } } },
  "openwikiLlm": { "preset", "apiKey", "baseUrl", "modelId", "providerId?" },
  "graphifyLlm": { "preset", "apiKey", "modelId?", "providerId?" },
  "lastMcpSync": { "<target>": { "ok", "applied", "removed", "error" } }
}
```

- Запись атомарная: `state.json.tmp` + rename; чтение - с merge на значения по умолчанию (частичный или повреждённый файл не останавливает консоль).
- Пути рабочих папок можно задавать через `~`/`~/…` - при загрузке и валидации они разворачиваются в домашний каталог (`expandHome` в `core/state.ts`), в состоянии и дальше по коду ходят только абсолютные пути.
- `workspaces.openwiki` - подмножество списка папок (тогглы вики OpenWiki); посторонние и убранные из списка пути отбрасываются молча при валидации.
- Настройки LLM-провайдеров - файлы в `.agents/providers/<id>/` (`core/providerSettings.ts`): `settings.json` (base URL, модели, scope - версионируется), `key.env` (ключ, `<ENV>=<значение>` - вне git), `ca.pem` (сертификат CA, вне git; `.gitignore` исключает `key.env` и `*.pem|*.crt|*.cer|*.key`). Записи старого формата из state.json мигрируются в файлы автоматически (`migrateProviderEntries`, server-context); в state.json остаются только поля проверки (`verifiedAt/verifyError/verifyModels`).
- Рядом со state хранятся служебные файлы консоли (не state, отдельные форматы): `package-manager.json` (выбор Bun/NPM, пишет и setup.sh), `tools.env` (плоское состояние для диспетчера `tooling/scripts/tool.sh`), `updates.json` (реестр зависимостей и статусы обновлений - вкладка "Обновить", `core/updates.ts`), `tools-usage.json` (события и метрики), `provider-usage.json` (статистика токенов: записи, итоги по провайдерам, счётчики по дням, курсоры инкрементальных коллекторов - [providers.md](providers.md)), `sessions.sqlite` (индекс сессий рантаймов: метрики, полнотекстовый поиск, курсоры коллектора - [sessions.md](sessions.md)), `dashboards.json` (pid автономных дашбордов Serena/Headroom), `tool-jobs/<id>.log|.json` (вывод и статус установочных job'ов - SSE читает файлы, инвариантно к HMR), `logs/<id>-dashboard.log` - [tools.md](tools.md)).
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
| Кеш задач nx (`.nx/`) | Верификация (AGENTS.md §7) идёт через `tooling/scripts/src/verify.ts`, который вызывает nx; таргеты `test`, `validate`, `build` объявлены в `project.json` проектов (`apps/console`, `tooling/harness`), входы и выходы - в `nx.json` | Повторный прогон на неизменённом коде читается из кеша: тесты tooling 5.5 с холодного запуска против ~0.07 с на cache hit |

Кеш nx: хранится в `.nx/` (в .gitignore; зона рекурсивного удаления разрешена - AGENTS.md §9), сброс - `node_modules/.bin/nx reset`. Напоминание `nx configure-ai-agents` в выводе задач - ожидаемая строка nx; команду не запускать: конфигурация агентов ведётся в harness (AGENTS.md). При отсутствии nx в `node_modules` verify.ts сообщает об этом и завершается с ошибкой (правило §7 - не молчать о непроверенном).

## Безопасность

- **SSRF-фильтр** для всех серверных fetch: только http/https, hostname из allowlist (`skills.sh`, `github.com`, `deepwiki.com`; marketplace - любые публичные хоста, но localhost/приватные/зарезервированные диапазоны запрещены), таймауты, лимит размера ответа. Исключение - запросы к LLM-провайдерам реестра ([providers.md](providers.md)): адрес вводит пользователь в своей карточке и валидируется `providerBaseUrlError` (только http/https, userinfo и metadata-хост запрещены; для онлайн-пресетов локальные/приватные/зарезервированные адреса запрещены, loopback разрешён только локальным пресетам). Ключи не логируются, запросы выполняются в процессе консоли.
- **Провайдеры реестра**: запуск промта - один in-process запрос (без дочерних процессов и оболочки, таймаут 5 мин), тело собирается `JSON.stringify`; ответ и ошибки - в файл лога runs. Транспорт провайдеров с CA-файлом или OAuth-схемой - `core/providerHttp.ts` (node:https, CA только запросов своего провайдера, проверка протокола и хоста до соединения); обмен OAuth-ключа на access-токен (`core/providerAuth.ts`) кешируется в памяти процесса, ключ не покидает консоль.
- **Агентный цикл (function calling)**: `core/agentLoop.ts` - цикл с инструментами для провайдеров (шаги workflow с кандидатом `provider:<id>`, детали в [workflows.md](workflows.md)); исполнители инструментов - `core/agentTools.ts` (изоляция рабочей папки, секретные пути, guard-проверка `run_command`, усечение вывода), MCP-инструменты - `core/mcp/client.ts` (соединения к серверам реестра в процессе консоли/воркера, неймспейс `mcp__<server>__<tool>`). Диалекты запросов - те же три kind пресетов, что в `core/providerRun.ts`.
- **Спавны процессов**: только литеральные команды (`bunx`, `claude`, `codex`, `kimi`, `opencode`, `node`, `open`, `sh`) с массивами аргументов; без оболочки; промпты санитизируются (NUL, длина, ведущий `-`); имена пакетов и MCP-серверов - строгие регексы. Обёрточные функции вокруг `spawn` не заводить: pre-commit сканер Mimosa блокирует их как инъекционные (паттерн - инлайн-switch с литералами, см. `core/prompts.ts`, `core/installJobs.ts`).
- **Чтение файлов памяти** (`GET /api/memory/file`): allowlist корней - только `*.md` внутри рабочих папок, недот-файлы внутри `<dir>/openwiki/`, memory-каталогов рантаймов и wiki-каталогов хранилища Graphify (`graphify/<имя>/graphify-out/wiki`), одиночные глобальные файлы (`~/.claude/CLAUDE.md`); realpath-контейн (symlink наружу запрещён), запрет скрытых компонент пути, потолок 1 МБ. Произвольные пути запрещены (`core/memory.ts#checkReadPath`).
- **Сборка OpenWiki**: спавн литеральной команды `openwiki --init|--update` (cwd = рабочая папка, без оболочки, пользовательский ввод не попадает); pid/режим - в `openwiki/.console-build.json`, лог - `openwiki/.console-build.log`.
- **Визуализатор**: экспорт - литеральная команда `openwiki visualize openwiki --export <dir>`; публикация - 5 файлов фиксированного набора копируются в `apps/console/public/visualizers/<slug>/` (slug - sha256 пути рабочей папки, каталог в .gitignore), Next отдаёт их статикой; динамических роутов с путями пользователя нет. `/api/memory/openwiki` пересинхронизирует и подчищает слаги.
- **Guard-политика репозитория** (AGENTS.md §3) не ослабляется: консоль пишет только в `.agents/console/`, MCP-конфиги (managed-имена) и не изменяет файлы навыков; `.gitignore` синхронизирован с запретами (секреты - вне git).
- Атомарные записи и `managed`-семантика MCP-синка - см. [mcp.md](mcp.md).
