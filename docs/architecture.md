# Архитектура Harness

Harness — локальная платформа управления агентами разработки. Репозиторий объединяет веб-консоль, исполняемую политику безопасности, адаптеры семи агентских рантаймов, долговечные workflow и плагины локальных инструментов. Этот документ задаёт границы системы и сквозные контракты; детали отдельных подсистем находятся в профильных документах из [индекса](README.md).

Интерактивное представление: [карта архитектуры](architecture-interactive.html) с фильтрами контуров, сквозными потоками и инспектором компонентов.

## Контекст и границы

Система запускается на машине разработчика и работает с выбранными пользователем рабочими папками. Внешними акторами являются разработчик, CLI-рантаймы Claude Code/Codex/ZCode/Cursor/Kimi/OpenCode/Antigravity, LLM-провайдеры, MCP-серверы и локальные CLI-инструменты. Harness владеет оркестрацией и локальным состоянием, но не владеет форматами сессий рантаймов и удалёнными моделями.

```
                           ┌──────────────────────┐
                           │     Разработчик      │
                           └──────────┬───────────┘
                                      │ browser / CLI
┌─────────────────────────────────────▼─────────────────────────────────────┐
│                              HARNESS                                      │
│                                                                           │
│  ┌───────────────────┐   ┌────────────────────┐   ┌────────────────────┐ │
│  │ Console           │   │ Guardrails         │   │ Hook tooling       │ │
│  │ UI · API · core   │──▶│ policy · audit     │◀──│ indexes · doctor   │ │
│  └─────────┬─────────┘   └──────────┬─────────┘   └─────────┬──────────┘ │
│            │                         │                       │            │
│  ┌─────────▼─────────────────────────▼───────────────────────▼──────────┐ │
│  │ .agents/: runtime config · skills · roles · state · tasks · runs   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────┬──────────────────────┬──────────────────────┬─────────────┘
               │                      │                      │
      ┌────────▼────────┐    ┌────────▼────────┐    ┌────────▼────────┐
      │ Agent runtimes │    │ LLM / MCP       │    │ Local tools     │
      │ headless + UI  │    │ providers       │    │ graph/wiki/etc. │
      └────────┬────────┘    └─────────────────┘    └─────────────────┘
               │
      ┌────────▼────────┐
      │ User workspaces │
      └─────────────────┘
```

Граница доверия проходит по входам из браузера, содержимому рабочих папок, выводу инструментов, MCP и ответам моделей. Все такие данные валидируются на сервере; команды, пути и сетевые адреса не считаются доверенными только потому, что пришли из локального UI.

## Состав репозитория

| Область | Ответственность | Владелец данных / источник правды |
|---|---|---|
| `apps/console` | Next.js UI, HTTP/SSE API, orchestration core, runtime adapters, workflow worker | `.agents/console/`, runtime session stores, workspace files |
| `.guardrails` (`@harness/guardrails`) | PreToolUse/PostToolUse policy, content scan/redaction, исключения, аудит интеграций | `.guardrails/rules/`, `schemas/`, `exceptions/` |
| `tooling/harness` (`@harness/tooling`) | Единая обёртка hook-событий, обновление индексов, doctor и проверка wiring | `tooling/harness/src/registry.ts` |
| `.agents/runtime` | Общая и vendor-конфигурация моделей, прав, verification и adapters | `.agents/runtime/config.json` + `<vendor>/config.json` |
| `.agents/skills`, `.agents/roles` | Канонические навыки, workflow и роли; native-каталоги содержат проекции/симлинки | мастер-каталоги `.agents/skills/**` и `.agents/roles/**` |
| `tooling/scripts` | Setup, диспетчер инструментов и verification entrypoints | `setup.sh`, `tool.sh`, `src/verify.ts` |
| `docs`, `openwiki` | Каноническая документация и производная wiki | `docs/` — ручной источник правды; `openwiki/` — генерируемая проекция |

Корневой Bun workspace включает `apps/*`, `.guardrails` и `tooling/harness`; Nx кеширует повторные `test`, `validate` и `build`, а `tooling/scripts/src/verify.ts` остаётся единым пользовательским входом в проверки.

## Технологический стек

| Слой | Технология |
|---|---|
| Раннер и workspace | Bun, Nx |
| Web | Next.js 16 App Router, React 19, Tailwind CSS v4 |
| Клиентское состояние | Zustand с persist для UI-настроек |
| HTTP и stream | Route Handlers, RSC, JSON, SSE |
| Агенты и workflow | LangGraph.js, AI SDK/LangChain, отдельный Bun worker |
| Хранение workflow | SQLite (`better-sqlite3`) + LangGraph checkpoint |
| Контракты | TypeScript, Zod, YAML, JSON Schema |
| Интеграции | MCP SDK, headless CLI адаптеры, локальные process/file adapters |
| Представление знаний | OpenWiki, Graphify, CodeGraph, Serena, QMD |

## Плоскости исполнения

### 1. Интерактивная консоль

```
Browser pages + uikit
        │ fetch / RSC / SSE
        ▼
app/api/** route handlers
        │ validate + authorize workspace/operation
        ▼
core/** domain services
        ├── filesystem and atomic state
        ├── runtime/provider adapters
        ├── MCP and local tool processes
        └── task/session/usage indexes
```

Страницы и компоненты в `src/app` и `src/uikit` не читают системные файлы напрямую. Route handlers принимают транспортный контракт, а `src/core` реализует доменные операции. Адаптеры `src/runtimes/*.ts` изолируют различия форматов и команд семи рантаймов.

### 2. Долговечная оркестрация

Next.js принимает запуск workflow, сохраняет неизменяемый snapshot конфигурации и будит отдельный `workflow-worker.ts`. Worker получает lease, выполняет LangGraph, пишет события, попытки, usage и checkpoints в SQLite выбранной рабочей папки. HTTP-процесс может перезапуститься без потери run; после аварии worker помечает осиротевший run как `interrupted`, а оператор возобновляет его через retry/restart из persisted checkpoint. Подробный автомат шага и протокол interrupts описаны в [workflows.md](workflows.md).

### 3. Политика и lifecycle hooks

Vendor hooks передают нормализованный payload в `.guardrails/src/cli.ts`. Guard строит контекст, применяет детерминированные правила и временные исключения, пишет решение в audit log и возвращает exit `0` или `2`. `tooling/harness/src/cli.ts` агрегирует независимые best-effort hooks Serena, CodeGraph и Graphify; их сбой наблюдаем через doctor, но не подменяет решение guard.

```
runtime event
     ├──▶ guard evaluate ──▶ allow / warn / block + audit
     └──▶ tooling wrapper ─▶ index hooks + budget log
```

## Основные сквозные потоки

### Прямой агентский запрос

1. `/agent` отправляет сообщение в `POST /api/agent/chat`.
2. Slash-команды и `@path` раскрываются по правилам выбранного executor; секретные пути отбрасываются.
3. Для `provider:<id>` строится LangGraph `model ↔ tools`; для runtime строится узел headless-запуска и поток логов.
4. Встроенные shell-инструменты проходят guard, MCP-инструменты вызываются через `core/mcp/client.ts`.
5. UI получает части ответа по stream, а задача и usage фиксируются в локальных ledgers.

### Workflow run

1. API валидирует YAML, роли, skills, runtime candidates и рабочую папку.
2. В SQLite записываются run и полный snapshot; после этого изменения каталога workflow не меняют начатый run.
3. Worker выбирает runtime/provider, выполняет секции input/execution/output control и сохраняет каждую попытку.
4. SSE читает persisted events; операторские interrupts возобновляют граф командой, совместимой с ETag состояния.
5. При ошибке действуют retry/failover/partial-run правила snapshot; после рестарта новый worker забирает lease и переводит осиротевший run в управляемый статус `interrupted`.

### Синхронизация конфигурации

1. Канонический реестр MCP, skills или commands изменяется через API.
2. Сервер валидирует манифесты и lifecycle hooks, затем атомарно сохраняет состояние.
3. Sync adapter обновляет только managed-секции vendor-файлов; пользовательские записи остаются нетронутыми.
4. Результат каждого target сохраняется отдельно, поэтому частичный сбой виден и повторяем.

### Проверка tool-вызова

1. Runtime hook или серверный executor формирует `{tool_name, tool_input}`.
2. Guard нормализует tool, команду и пути, сопоставляет детерминированные правила и активные исключения.
3. Block возвращает exit `2` и безопасную альтернативу; allow/warn продолжают вызов.
4. Решение и policy digest доступны аудиту Console.

## Данные и инварианты

| Данные | Хранилище | Инвариант |
|---|---|---|
| Vendor/runtime policy | `.agents/runtime/**/*.json` | Console читает конфиги, а не дублирует список runtime в UI |
| Console preferences и registry | `.agents/console/state.json` | атомарная запись tmp+rename; серверный файл опережает client store |
| Provider settings | `.agents/providers/<id>/settings.json` | ключ и CA лежат в исключённых из Git `key.env`/`ca.pem` |
| Direct chats, tasks, logs | `.agents/console/{direct,tasks,runs,logs}` | файловые форматы переживают HMR и рестарт web-процесса |
| Session search | `.agents/console/sessions.sqlite` | производный индекс; исходные session stores принадлежат runtime |
| Workflow state | `.agents/console/workspaces/<key>/workflows.sqlite` | отдельная БД на рабочую папку; snapshot run неизменяем, lease и checkpoints восстанавливаемы |
| Skills, roles, workflows | `.agents/skills`, `.agents/roles` | канонический каталог отделён от native-проекций runtime |
| Guard policy | `.guardrails/rules`, `exceptions`, `audit` | правило имеет стабильный id; исключение ограничено целью и сроком |

Ключевые системные инварианты:

- **Workspace containment:** файловая операция разрешена только после нормализации, realpath-проверки и сопоставления с разрешённым root.
- **Managed ownership:** синк изменяет только записи, которыми владеет Harness.
- **Durable before visible:** мутация состояния или workflow сначала фиксируется на диске, затем подтверждается клиенту.
- **No shell interpolation:** процессы запускаются бинарником и массивом аргументов; пользовательский текст не собирается в shell-строку.
- **Reproducible runs:** активный workflow зависит от snapshot, а не от меняющихся файлов каталога.
- **Guard before side effect:** потенциально опасная команда проверяется до запуска и журналируется.

## Отказы и восстановление

| Сбой | Обнаружение | Восстановление |
|---|---|---|
| Web/HMR restart | HTTP/SSE reconnect | файловое состояние и SQLite сохраняются; UI перечитывает snapshot |
| Worker crash | lease heartbeat/PID status | новый worker забирает истёкший lease, помечает run `interrupted`; оператор запускает retry/restart из checkpoint |
| Runtime/provider недоступен | probe, timeout, structured error | failover к следующему кандидату либо operator interrupt |
| Частичный MCP/skill sync | per-target result в state | повторный sync только нужных managed targets |
| Зависший дочерний процесс | task/process inventory и heartbeat | SIGTERM, grace period, затем разрешённый SIGKILL |
| Повреждённый console state | parse/normalization | merge с defaults; невалидные поля отбрасываются |
| Необязательный index tool недоступен | `tool.sh` exit 3, doctor | деградация к обычному чтению; установка не происходит автоматически |

## Архитектурные решения

| Решение | Выбранный вариант | Причина и цена |
|---|---|---|
| Локальная control plane | Next.js server на машине пользователя | прямой доступ к CLI/ФС; Console не предназначена для публичного multi-tenant deployment |
| Vendor abstraction | общий server core + тонкие runtime adapters | единые фичи при разных форматах; новый runtime требует adapter, session reader и wiring |
| Workflow durability | отдельный worker + SQLite snapshot/checkpoint | восстановление после рестарта; нужен lease и миграции схемы |
| Policy enforcement | общий Guard CLI, подключённый native hooks и server executors | одна семантика решения; покрытие зависит от корректного wiring каждого runtime |
| Конфигурационный sync | canonical registry + managed projections | сохраняет ручные настройки пользователя; требуется стабильная маркировка ownership |
| Плагины инструментов | декларативный `ToolDef` + `tool.sh` dispatcher | общий lifecycle и диагностика; внешний инструмент требует plugin-обвязки |
| Документация | `docs/` канонична, OpenWiki производна | ручные документы пригодны для ревью; wiki нужно пересобирать после крупных изменений |

## Слои Harness Console

```
┌──────────────────────────── Клиент ─────────────────────────────┐
│ Страницы src/app · UIKit src/uikit · Zustand stores             │
└───────────────────┬─────────────────────────────────────────────┘
                    │ fetch (RSC / JSON / SSE)
┌───────────────────▼──────────────── Сервер ─────────────────────┐
│ Route Handlers src/app/api/**                                   │
│ Core: state · registry · providers · sessions · MCP · skills ·  │
│       tools · agents · workflows · monitoring · knowledge       │
│ Lib: server context · filesystem/process signals · parsers      │
├─────────────────────────────────────────────────────────────────┤
│ Runtime adapters src/runtimes/*.ts × 7                          │
└────────┬───────────────────┬───────────────────┬────────────────┘
         │                   │                   │
     filesystem         process signals      headless CLI / MCP
```

Ключевые инварианты:

- **Источник правды о списке рантаймов** - `.agents/runtime/<vendor>/config.json` (см. [runtimes.md](runtimes.md)); консоль только читает эти конфиги.
- **Состояние консоли** - `.agents/console/state.json`; локальный файл, вне Git (содержит пути этой машины). Мутации всегда идут по схеме "сначала файл (атомарно, tmp+rename), потом ответ клиенту, потом клиентский стор" (см. ниже).
- **UI-плагины рантаймов** (`src/plugins/runtimes/`) - только оформление (монограммы/цвета); данные всегда приходят с сервера.
- **Workflow-run неизменяем по конфигурации**: при старте сохраняется разрешённый YAML, содержимое использованных ролей и их internal skills, модели и хэши runtime-конфигов. Worker выполняет snapshot, а не перечитывает изменившийся каталог.
- **Долгоживущая оркестрация**: Next.js только принимает команды и отдаёт SSE. Отдельный worker удерживает lease, пишет checkpoints и восстанавливает незавершённый run после аварии.

Подробные контракты шага с секциями контроля, failover, partial run, interrupts, ETag и хранения описаны в [workflows.md](workflows.md). Роли находятся в [roles.md](roles.md), ledger и стоимость в [stats.md](stats.md).

Интерактивная карта слоёв и сквозных потоков - вкладка "Архитектура" (`/architecture`) на React Flow: узлы (страницы, API, ядро, адаптеры, рантаймы, workflow-движок и его YAML-каталог, роли, навыки, MCP, провайдеры, guardrails, состояние, tooling, инструменты, design pack, рабочие папки, знание, плагины и моды, наблюдаемость), связи между ними и семь сквозных потоков. Клик по узлу открывает описание, ключевые файлы и список связей, связи выбранного узла подсвечиваются; поиск по узлам и фильтр по слоям (чипы над канвой и кликабельная легенда) приглушают остальную канву. Данные карты - статические (`apps/console/src/uikit/components/architecture/data.ts`) и правятся одной серией с этим документом.

Раздел включает четыре вкладки: **Карта** (слои и связи, см. выше), **Система** (исполняемые контуры control plane / execution / policy / data / external: 10 узлов с ответственностью, владельцем данных и отказом), **Потоки** (четыре сквозных сценария по шагам: прямой запрос, workflow run, синхронизация конфигурации, проверка tool-вызова) и **Данные** (хранилища вокруг контракта долговечности "persist before visible"). Вкладки Система / Потоки / Данные перенесены из `docs/architecture-interactive.html` (`apps/console/src/uikit/components/architecture/views.ts`).

## Реестр API

| Роут | Назначение |
|---|---|
| `GET /api/runtimes?window=` | Срез статусов всех рантаймов (кеш 5 с) |
| `PATCH /api/runtimes` | Выбрать рантайм по умолчанию (★) |
| `GET /api/runtimes/list` | Лёгкий перечень рантаймов без проба (для стора) |
| `GET /api/guardrails` | Актуальный снимок правил, покрытия, policy digest и точек интеграции для вкладки аудитора |
| `POST /api/guardrails` | Фиксированные действия аудитора: `check`, `test`, `generate`; произвольные команды не принимаются |
| `GET/POST/DELETE /api/guardrails/exceptions` | Исключения политики (`@harness/guardrails` loader): список активных/просроченных/битых; POST - создание из консоли (ruleId, reason, срок, singleUse-разовое, scope-шаблоны command/path/tools; эквивалент CLI `approve`); DELETE `?id=` - отзыв файла исключения |
| `GET /api/guardrails/events` | Хвост журнала решений `audit/events.jsonl` с агрегатами (7 дней: эффекты, топ правил, исключения, p95) |
| `GET/POST/PATCH/DELETE /api/mcp` | MCP-реестр (GET отдаёт `label` происхождения: builtin/tool/plugin/preset/manual) + прогон синка; PATCH принимает `enabled`, `runtimeOverride`, `transport` и `hooks` (правка настроек сервера, http - с `headers`); хуки жизненного цикла (install/enable/disable/remove) исполняются `core/lifecycleHooks.ts` после guard-проверки, cwd - обязательная рабочая папка, ошибки - `hookErrors` |
| `GET /api/mcp/catalog` | Пресет-каталог MCP (первым - собственный сервер harness; далее пресеты + serena/qmd/codegraph; npx-пресеты адаптируются под выбранный менеджер bun/npm) |
| `GET/PUT /api/mcp-server` | Собственный MCP-сервер harness (`apps/console/src/mcp-server/`): конфиг `.agents/console/mcp-server.json` (группы инструментов, экспонируемые рабочие папки, динамические workflow-инструменты), регистрация stdio-записи `harness` и HTTP-транспорта `harness-http` (токен `state.mcpHttp`); после мутаций - managed-синк. Панель - "Настройки → MCP → Собственный сервер harness"; детали - [mcp.md](mcp.md) |
| `POST/GET/DELETE /api/mcp/harness` | HTTP-транспорт собственного MCP-сервера (streamable HTTP, ответы JSON, сессии по `mcp-session-id`): один сборщик инструментария со stdio-входом `bun apps/console/src/mcp-server/index.ts`. Авторизация - Bearer-токен `state.mcpHttp` (403 выключен, 401 неверный токен); инструменты - запуск промтов/workflow, рутины, каталог рабочих папок, сессии, мониторинг, знания (`mcp__harness__<tool>`) |
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
| `GET /api/mods` | Каталог модов Claude Code (`core/mods.ts`) + статусы зеркала `state.mods`; `?reconcile=1` сверяет статусы с CLI (`claude plugin list --json`, `claude plugin marketplace list --json`) |
| `POST/PATCH/DELETE /api/mods` | Установить (`claude plugin marketplace add` + `claude plugin install --scope user -y`; clone-источники сначала shallow-clone в `.agents/.tmp/mods/`), вкл/выкл (`claude plugin enable/disable`), удалить (`claude plugin uninstall`); без CLI claude - ошибка |
| `GET /api/processes?runtime=` | Процессы рантайма (uptime/cpu/mem/kind) |
| `POST /api/processes/action` | stop (SIGTERM→SIGKILL) / restart (только .app) |
| `GET /api/monitoring/processes` | Все процессы консоли (рантаймы/MCP/провайдеры/инструменты) с ресурсами и маркером "безопасно"; детали - [operations.md](operations.md) ("Мониторинг: процессы") |
| `POST /api/monitoring/processes/action` | stop процесса инвентаризации с перепроверкой PID классификатором |
| `GET /api/sessions?runtime=&dir=&id=` | Список сессий / детали-превью; `runtime` - один рантайм или список через запятую, без параметра - объединённый список всех рантаймов с историей (сортировка по свежести, лимит 500); `id` - только при одном рантайме |
| `POST /api/sessions/reply` | Headless-ответ в сессию (resume) |
| `POST /api/prompts/run` | Промт в новой сессии (рантайм задачи/★) или провайдеру задачи (`provider:<id>`, in-process запрос, ответ в лог runs); `workspace` - рабочая папка запуска (cwd процесса; для провайдера не применяется) |
| `GET/POST /api/routines` | Рутины рабочей папки: список с последними запусками и статусом воркера / создание (заголовок, промт, исполнитель - рантайм или `provider:<id>`, расписание: интервал минут 15-10080 или cron-выражение локальной таймзоны не чаще 5 минут; потолок 20 включённых). Определения - в workspace-базе workflow (таблицы `routines`, `routine_runs`); следующий запуск считает cron-parser (`computeNextRunAt`); исполнение - workflow-воркер (`core/routines.ts`, тик 5 с, аренда исключает дубль) |
| `GET/PATCH/DELETE/POST /api/routines/<id>` | Рутина: детали с историей запусков / правка (смена расписания или включение пересчитывает следующий запуск от текущего момента) / удаление с историей / POST - "запустить сейчас" (запрос `manual_run_at`, исполняет воркер, расписание не сдвигается) |
| `GET /api/optimization` | Состояние оптимизации: отчёты Claude Insights и CodeBurn, время последних запусков, разрешённый исполнитель и готовность `readiness` (claudeInstalled - детект адаптера Claude Code; codeburnInstalled/codeburnEnabled - CLI и запись инструмента CodeBurn) |
| `POST /api/optimization/report` | Сформировать отчёт рекомендаций: сводка статистики за 30 дней (`core/optimization.ts`: usage_receipts, индекс сессий, каталог цен) уходит провайдеру синхронным запросом (до 5 мин), JSON-ответ сохраняется в `settings.optimization.reports` |
| `POST /api/optimization/run` | Запуск оптимизации: промпт из выбранных рекомендаций (`ids`) уходит исполнителю задачи "Оптимизация" (headless-рантайм или `provider:<id>`); при успехе фиксируется `settings.optimization.lastOptimizedAt`; задача видна в "Мониторинг → Задачи" |
| `GET/POST /api/lessons`, `POST /api/lessons/<id>` | Библиотека уроков `.agents/lessons/`: список записей (`kind: Lesson`), агрегация предложений из lessons-артефактов прогонов и ретроспектив спринтов (`action:"collect"`), решение оператора (adopted/rejected); принятые уроки движок внедряет в задания секций ([optimization.md](optimization.md)) |
| `GET/POST /api/skills/evals` | Оценка навыков: каталог evals master-навыков, исполнители, сводки прогонов; POST запускает отвязанный раннер (кейсы у выбранных исполнителей, судья-провайдер, отчёты в `.agents/console/tasks/<id>/skill-evals/`) |
| `GET/POST /api/optimization/probe`, `POST /api/optimization/probe/run`, `GET/POST /api/optimization/probe/<id>` | Контрастивные пробы обвеса: сводки и предложение вариантов провайдером; запуск раннера (worktree на вариант, замены по whitelist, контрастный отчёт); отчёт пробы и внедрение выбранного варианта агентом рантайма |
| `GET /api/design/workspace?dir=` | Дизайн-контекст рабочей папки: статус пакета (DESIGN.md, ui-kit, components), managed-блоков CLAUDE.md/AGENTS.md, дизайн-MCP, design router ([design.md](design.md)) |
| `POST /api/design/workspace` | Действия пакета и синка: init из пресета themes/, save-design, save-uikit, scan-components, save-components, sync/desync managed-блоков; dir - только рабочие папки консоли |
| `POST /api/design/run` | Дизайн-задача единым интерфейсом: runtime (headless claude/opencode/... с cwd = папка), provider (агентный цикл с MCP open-design/figma) или session (headless-resume) - `core/design/run.ts` |
| `POST /api/design/artifacts` | Артефакты open-design: список инструментов MCP-сервера и вызов list-инструмента (только чтение) |
| `POST /api/agent/chat` | Диалог вкладки "Агент" (раздел /agent): UIMessage-стрим. Обе ветки исполняются как LangGraph-граф (`core/agent/chatGraph.ts`, стрим в части UI - `core/agent/chatStream.ts`). Провайдер - граф "model"-"tools": LangChain-модель по kind пресета (`core/langchain/chatModel.ts`: openai → ChatOpenAI с базовым URL из записи, anthropic → ChatAnthropic, gemini → ChatGoogleGenerativeAI; effort → `reasoning_effort` онлайн openai-совместимым), json-render спека из ```spec-блоков через `createJsonRenderTransform`; инструменты - встроенные `read_file`/`list_dir`/`run_command` (`core/agentTools.ts`, лимит 10 шагов модели) и MCP-серверы реестра (`core/mcp/client.ts`); рантайм - узел графа запускает `launchPromptRun` (cwd/model/effort) и стримит лог-файл, пока жив процесс. Перед запуском последняя реплика разбирается на slash-команды (`core/workflows/skills.ts`): `/master:<id>` и `/agent:<id>` раскрываются (рантайм - блоки в промте; провайдер - роль и навыки в системный промт), `@путь` у провайдера разворачивается в содержимое файлов, у рантайма остаётся токеном; секреты (.env*, *.pem, *.key, *id_rsa*, secrets/) не читаются; недоверенное содержимое оборачивается блоками UNTRUSTED; ошибка раскрытия - HTTP 400; токен `/workflow:` в чате отклоняется (запускается клиентом). Путь провайдера дополнительно проверяется `providerBaseUrlError` (запрет приватных адресов онлайн-провайдеров); агентный цикл ограничен 50 вызовами инструментов и 32 KB вывода инструмента в контексте. Каждый запуск - задача в реестре |
| `POST /api/agui` | Endpoint протокола AG-UI 1.0 (HTTP SSE binding) для внешних клиентов (CopilotKit OpenBot/OpenDuet/OpenMuse, bring-your-own-agent): тело - RunAgentInput `{threadId, runId, messages, context}`, ответ - `text/event-stream` с событиями `RUN_STARTED` / `TEXT_MESSAGE_*` / `TOOL_CALL_*` / `RUN_FINISHED|RUN_ERROR` (адаптер `core/agui/adapter.ts` поверх стрима direct-чата). Исполнитель - `context.executor` (рантайм, `provider` или `provider:<id>`; по умолчанию - исполнитель промтов), `context.tier/effort` уточняют модель; cwd - корень репозитория. Авторизация: `Authorization: Bearer <token>` из `state.agui` (403 выключен, 401 неверный токен; ошибки до старта стрима - HTTP-коды). Ограничения v1: только серверные инструменты, нет resume; история треда дописывается в direct-чат `direct-agui-<threadId>`; подробности - [agui.md](agui.md) |
| `GET/PUT /api/agui/config` | Управление AG-UI endpoint ("Настройки → Основные"): состояние, Bearer-токен и регенерация (`PUT {enabled, regenerate}`; токен создаётся при первом включении, 32 символа base64url) |
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
| `GET /api/rea` | Раздел "Реверс": статус CLI rea, каталог операций (`core/rea.ts`), провайдеры (`rea providers --json`, синхронный снимок), реестр анализов (последние 50) |
| `POST /api/rea/run` | Операции rea как job'ы инструментов (терминал - SSE `/api/tools/job`): `analysis` - analyze/inspect-* с evidence-файлом, `environment` - environment-build в `sources/<имя>` (каталог должен отсутствовать или быть пустым), `doctor`; записи - `.agents/console/rea/analyses.jsonl`, onDone job'а обновляет статус |
| `GET /api/rea/analysis?id=` | Evidence-отчёт записи реестра (только по id; файл больше 4 МБ - первые 4 МБ с признаком обрезки) |
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
| `GET /api/monitoring/processes` | Инвентаризация процессов консоли - рантаймы, MCP-серверы, локальные провайдеры, инструменты; cpu/mem/uptime, источник, маркер "безопасно остановить" с причиной (`core/processInventory.ts`) |
| `POST /api/monitoring/processes/action` | stop (SIGTERM→SIGKILL); перед сигналом PID перепроверяется классификатором инвентаризации по свежему ps |
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
  "mods": { "installed": {}, "marketplaces": [] },
  "workspaces": { "mandatory": "<путь>", "additional": [], "openwiki": [], "graphify": [] },
  "tools": { "installed": { "<id>": { "runtimes", "params", "at", "enabled" } } },
  "openwikiLlm": { "preset", "apiKey", "baseUrl", "modelId", "providerId?" },
  "graphifyLlm": { "preset", "apiKey", "modelId?", "providerId?" },
  "agui": { "enabled": false, "token": "" },  // AG-UI endpoint (POST /api/agui): Bearer-токен внешних клиентов; включается в "Настройки → Основные"
  "mcpHttp": { "enabled": false, "token": "" },  // HTTP-транспорт собственного MCP-сервера (POST /api/mcp/harness); включается в "Настройки → MCP"
  "lastMcpSync": { "<target>": { "ok", "applied", "removed", "error" } }
}
```

- Запись атомарная: `state.json.tmp` + rename; чтение - с merge на значения по умолчанию (частичный или повреждённый файл не останавливает консоль).
- Пути рабочих папок можно задавать через `~`/`~/…` - при загрузке и валидации они разворачиваются в домашний каталог (`expandHome` в `core/state.ts`), в состоянии и дальше по коду ходят только абсолютные пути.
- `workspaces.openwiki` - подмножество списка папок (тогглы вики OpenWiki); посторонние и убранные из списка пути отбрасываются молча при валидации.
- Настройки LLM-провайдеров - файлы в `.agents/providers/<id>/` (`core/providerSettings.ts`): `settings.json` (base URL, модели, scope - версионируется), `key.env` (ключ, `<ENV>=<значение>` - вне git), `ca.pem` (сертификат CA, вне git; `.gitignore` исключает `key.env` и `*.pem|*.crt|*.cer|*.key`). Записи старого формата из state.json мигрируются в файлы автоматически (`migrateProviderEntries`, server-context); в state.json остаются только поля проверки (`verifiedAt/verifyError/verifyModels`).
- Рядом со state хранятся служебные файлы консоли (не state, отдельные форматы): `package-manager.json` (выбор Bun/NPM, пишет и setup.sh), `tools.env` (плоское состояние для диспетчера `tooling/scripts/tool.sh`), `updates.json` (реестр зависимостей и статусы обновлений - вкладка "Обновить", `core/updates.ts`), `tools-usage.json` (события и метрики), `provider-usage.json` (статистика токенов: записи, итоги по провайдерам, счётчики по дням, курсоры инкрементальных коллекторов - [providers.md](providers.md)), `sessions.sqlite` (индекс сессий рантаймов: метрики, полнотекстовый поиск, курсоры коллектора - [sessions.md](sessions.md)), `dashboards.json` (pid автономных дашбордов Serena/Headroom), `tool-jobs/<id>.log|.json` (вывод и статус установочных job'ов - SSE читает файлы, инвариантно к HMR), `logs/<id>-dashboard.log`, `rea/analyses.jsonl` + `rea/evidence/<id>.json` (реестр анализов и evidence-отчёты раздела "Реверс" - `core/rea.ts`) - [tools.md](tools.md)).
- Любой мутирующий роут: мутация → `saveState()` → ответ → клиент обновляет стор. Клиентский стор никогда не опережает файл.
- Все мутации вызывают `invalidateDashboardCache()`.

## Наблюдаемость и эксплуатация

Console сводит состояние нескольких независимых процессов и файловых журналов, поэтому наблюдаемость строится вокруг устойчивых локальных идентификаторов задачи, run, step, attempt, runtime/provider и workspace. Основные сигналы:

- task registry и process inventory показывают активные и завершённые операции, PID, heartbeat, длительность и ошибку;
- workflow event ledger и step attempts связывают контрольные секции, исполнителя, токены, стоимость и артефакты;
- Guard audit хранит rule id, effect, runtime и policy digest без раскрытия исходного секрета;
- hook doctor сверяет wiring и бюджеты Serena/CodeGraph/Graphify по `.agents/.tmp/hooks/hooks.log`;
- session и usage collectors используют курсоры, поэтому после рестарта дочитывают только новые записи.

Готовность проверяется на двух уровнях: `verify-fast` для локальной итерации и `verify-integration` перед объединением. Диагностика необязательного инструмента не должна автоматически устанавливать или включать его: состояние `TOOL_UNAVAILABLE` является штатной деградацией.

## Развёртывание, совместимость и откат

Harness развёртывается как локальный checkout: `bun run setup` готовит зависимости, `bun run console` поднимает dev-сервер на `:3000`. Изменения persistent-форматов должны читаться с defaults и нормализацией старых полей; workflow run сохраняет версию snapshot и не мигрирует конфигурацию посреди исполнения. Managed-проекции MCP/skills/commands пересоздаются из канонического реестра, поэтому их можно восстановить повторным sync.

Откат версии выполняется возвратом Git checkout и повторной установкой зависимостей. Перед несовместимым изменением SQLite или файлового state нужна отдельная миграция с резервной копией: старый бинарник не обязан понимать уже преобразованный формат. Публикация версии идёт через `VERSION` и release workflow, описанный в [индексе документации](README.md).

## Производительность

| Механизм | Что делает | Эффект |
|---|---|---|
| Микрокеш дашборда (`core/cache.ts`) | TTL 5 с + дедуп параллельных пересчётов; инвалидация мутациями | Повторные открытия `/` мгновенны; опрос 10 с держит кеш тёплым |
| Only-проб space | `/runtime/[id]` пробит один рантайм, не все семь | Страница рантайма 1.7-2.5 с → ~0.05 с |
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
- **Спавны процессов**: только литеральные команды (`bunx`, `claude`, `codex`, `kimi`, `agy`, `opencode`, `node`, `open`, `sh`) с массивами аргументов; без оболочки; промпты санитизируются (NUL, длина, ведущий `-`); имена пакетов и MCP-серверов - строгие регексы. Обёрточные функции вокруг `spawn` не заводить: pre-commit сканер Mimosa блокирует их как инъекционные (паттерн - инлайн-switch с литералами, см. `core/prompts.ts`, `core/installJobs.ts`).
- **Чтение файлов памяти** (`GET /api/memory/file`): allowlist корней - только `*.md` внутри рабочих папок, недот-файлы внутри `<dir>/openwiki/`, memory-каталогов рантаймов и wiki-каталогов хранилища Graphify (`graphify/<имя>/graphify-out/wiki`), одиночные глобальные файлы (`~/.claude/CLAUDE.md`); realpath-контейн (symlink наружу запрещён), запрет скрытых компонент пути, потолок 1 МБ. Произвольные пути запрещены (`core/memory.ts#checkReadPath`).
- **Сборка OpenWiki**: спавн литеральной команды `openwiki --init|--update` (cwd = рабочая папка, без оболочки, пользовательский ввод не попадает); pid/режим - в `openwiki/.console-build.json`, лог - `openwiki/.console-build.log`.
- **Визуализатор**: экспорт - литеральная команда `openwiki visualize openwiki --export <dir>`; публикация - 5 файлов фиксированного набора копируются в `apps/console/public/visualizers/<slug>/` (slug - sha256 пути рабочей папки, каталог в .gitignore), Next отдаёт их статикой; динамических роутов с путями пользователя нет. `/api/memory/openwiki` пересинхронизирует и подчищает слаги.
- **Guard-политика репозитория** (AGENTS.md §3) не ослабляется: консоль пишет только в `.agents/console/`, MCP-конфиги (managed-имена) и не изменяет файлы навыков; `.gitignore` синхронизирован с запретами (секреты - вне git).
- Атомарные записи и `managed`-семантика MCP-синка - см. [mcp.md](mcp.md).

## Ограничения и риски

- Console рассчитана на доверенного локального пользователя и не имеет tenant isolation; публикация сервера в сеть потребует отдельной аутентификации, авторизации и sandbox-модели.
- Покрытие Guard зависит от vendor hook support. `adaptersCheck` обнаруживает расхождение wiring, но новый или изменившийся runtime может временно оставить непокрытую поверхность.
- Session stores принадлежат внешним runtime и могут менять формат. Readers должны деградировать в `unsupported/error`, не повреждая исходные данные.
- SQLite и файловые ledgers оптимальны для одной машины и умеренного параллелизма. Multi-host orchestration потребует общего transactional store и распределённого lease.
- OpenWiki, Graphify, CodeGraph, Serena и QMD являются производными индексами. Их отсутствие или устаревание ухудшает поиск, но не должно менять поведение Console, Guard или workflow.
- Команды tool plugins выполняются на машине пользователя. Безопасность зависит от строгих аргументов без shell interpolation, guard-проверки и явного lifecycle в реестре инструментов.
