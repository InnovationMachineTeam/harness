# Инструменты экономии контекста

Реестр внешних инструментов (Serena, qmd, CodeGraph, Graphify, RTK, Headroom, OpenWiki, Open Design, AgentPlane). Канонические места:

- плагины инструментов - `apps/console/src/core/tools/<id>.ts` (по модулю на инструмент; как написать новый - [tools-dev.md](tools-dev.md)); реестр-агрегатор - `core/tools.ts`;
- диспетчер вызовов агентами - `tooling/scripts/tool.sh`;
- системная установка - `tooling/scripts/setup.sh` (`bun run setup`);
- жизненный цикл в UI - "Настройки → Инструменты" (API `/api/tools/*`).

**Диагностика**: кнопка "Диагностика" в карточке проверяет CLI, зависимости, per-runtime интеграции, MCP-реестр и доступность дашборда; при проблемах формируется промпт headless-исправления (кнопка "Исправить" → `/api/prompts/run`, рантайм задачи "Исполнение команд").

## Карта интеграций

| Инструмент | Системный пакет | MCP | Per-runtime | Граф/дашборд |
|---|---|---|---|---|
| [Serena](https://github.com/oraios/serena) | `uv tool install -p 3.13 serena-agent` | да (`serena start-mcp-server --context=ide --project-from-cwd`) | нет (MCP-реестр) | дашборд `127.0.0.1:24282` (iframe) |
| [qmd](https://github.com/tobi/qmd) | PM: `bun add -g @tobilu/qmd` / `npm i -g` | да (`qmd mcp`) | нет + индексация рабочих папок (`qmd collection add`) | - |
| [CodeGraph](https://github.com/colbymchenry/codegraph) | PM: `… @colbymchenry/codegraph` | да (`codegraph serve --mcp`) | `codegraph install -t <id> -l global -y` | UI гейтится `CODEGRAPH_UI=1` - отложен |
| [Graphify](https://github.com/safishamsi/graphify) | `uv tool install graphifyy` (пакет с двумя "y") | опц. (`python -m graphify.serve`) | `graphify install --platform <p>` | граф - раздел "Знание" |
| [RTK](https://github.com/rtk-ai/rtk) | `brew install rtk` | нет | `rtk init -g [--agent <a>]` | `rtk gain` → статистика |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | `uv tool install --python 3.13 "headroom-ai[all]"` | да (режим mcp) | прокси-сервис (autostart); сессии - `headroom wrap <runtime>` в терминале | дашборд `127.0.0.1:8787` (iframe) |
| [OpenWiki](https://github.com/langchain-ai/openwiki) | PM: `… openwiki` | нет | нет | раздел "Знание" |
| [Nx](https://nx.dev) | PM: `bun add -g nx` / `npm i -g` | нет | нет | локальный кеш задач `.nx/` |
| [Open Design](https://github.com/nexu-io/open-design) | desktop-приложение и CLI `od` | да (`od mcp --daemon-url http://127.0.0.1:7456`) | `od mcp install` только после capability check | - |
| [AgentPlane](https://github.com/basilisk-labs/agentplane) | PM: `… agentplane` | нет | граф знания и lifecycle задач | дашборд `127.0.0.1:24287` (iframe); Stats: readiness и задачи по статусам |
| [CodeBurn](https://github.com/getagentseal/codeburn) | PM: `bun add -g codeburn` / `npm i -g` | нет | нет | данные отчёта CodeBurn (вкладка "Оптимизация"; без инструмента - null-state) |

Unsupported-матрица per-runtime (детали - `core/tools.ts`):

- **CodeGraph**: нет kimi/zcode (MCP доступен через проектный `.mcp.json`);
- **RTK** (по `rtk init --help` 0.39.x): нет zcode (rtk-ai/rtk#2898) и codex (флага `--codex` в `rtk init` нет; opencode - отдельный флаг `--opencode`; kimi - project-scoped, правила пишутся в AGENTS.md репозитория; префикс `rtk <cmd>` работает и без хука). **Project-uninstall**: RTK не умеет снимать project-scope ("manually remove RTK from CLAUDE.md") - при uninstall из консоли зачистка программная: маркерные блоки `<!-- rtk-instructions -->` из CLAUDE.md/AGENTS.md и файлы `.rtk/filters.toml`, `.opencode/plugins/rtk.ts`, `.claude/RTK.md`;
- **Headroom wrap**: cursor - вручную (`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`);
- **Graphify**: zcode - generic-платформа `agents` (skill в `~/.agents/skills`, при project-scope - `./.agents/skills/`);
- **Nx**: per-runtime интеграций нет - чистый CLI для проектов с `nx.json`; в этом репозитории вызывается внутри `verify.ts` (кеш `.nx/`, `nx.json` + `project.json` проектов; AGENTS.md §7). Команду `nx configure-ai-agents` не запускать - конфигурация агентов ведётся в harness;
- **Open Design**: Console проверяет `od mcp --help`. Актуальный контракт использует `--daemon-url`. Legacy `od mcp install <agent>` применяется только при наличии команды в help. Детект `which od` может найти системный octal-dump, поэтому проверка требует capability `--daemon-url`.

## Пакетный менеджер npm-пакетов (Bun | NPM)

Выбор делает `setup.sh` (вопрос при первом запуске; default - Bun) или Select в разделе "Инструменты". Хранится в `.agents/console/package-manager.json`, применяется к: установке npm-инструментов (`bun add -g` ↔ `npm install -g`) и stdio-пресетам MCP каталога (`bunx <pkg>` ↔ `npx -y <pkg>`; уже установленные серверы не перезаписываются).

## Хуки жизненного цикла

Определение инструмента (ToolDef в `core/tools/<id>.ts`) может объявить `hooks: {install?, remove?, enable?, disable?}` - списки shell-команд. Исполнение - общее с навыками, MCP и плагинами (`core/lifecycleHooks.ts`): guard-проверка репозитория, `bash -c`, cwd = обязательная рабочая папка (write mode), таймаут 60 с, лог `.agents/console/hooks/tool.log`. install - после успешной установки/переустановки (включая синхронный путь без job), remove - до зачистки при uninstall, enable/disable - на toggle (оба пути: синхронный и job). Ошибки хуков в лог домена; ответ задачи их не блокирует.

## Жизненный цикл (Настройки → Инструменты)

Состояния: `missing` → `on` → `off` (запись `state.tools.installed[id]`: `{runtimes, params, at, enabled}`; для MCP-инструментов отражается в реестре `state.mcp.servers`). Кнопки по состоянию: "Установить" / "Выключить" / "Включить" / "Переустановить" (uninstall+install с сохранёнными параметрами) / "Удалить" (интеграции + MCP-запись; системный пакет остаётся - команда ручной очистки в подтверждении). Установка - job с SSE-терминалом (`/api/tools/job`), интерактивные установщики получают stdin.

Нюансы uninstall/reinstall:

- шаги снятия - **optional**: "нечего снимать" или каприз CLI не ломает переустановку (uninstall-код не останавливает цепочку);
- RTK: `--uninstall` работает только с `-g` для любых агентов (проверено на CLI 0.39.x); project-снятие CLI не умеет - консоль зачищает программно (блоки `<!-- rtk-instructions -->` в CLAUDE.md/AGENTS.md и файлы `.rtk/filters.toml`, `.opencode/plugins/rtk.ts`, `.claude/RTK.md`);
- Headroom: uninstall останавливает прокси-инстанс и сбрасывает autostart (`uninstallStopsDashboard`);
- в запись `installed` мержатся интеграции, найденные маркерами на диске - uninstall/reinstall не теряет внешние/ранние установки.

**Диагностика** - кнопка в карточке (`POST /api/tools/diagnose`): проверки CLI, зависимостей, per-runtime интеграций, MCP-реестра, доступности дашборда (TCP-проба) и хуков (RTK). Символы: `✓` ок, `✗` критичный провал, `-` информационно. При критичных провалах формируется промпт headless-исправления - кнопка "Исправить" отправляет его в `/api/prompts/run` (рантайм задачи "Исполнение команд").

API:

| Роут | Назначение |
|---|---|
| `GET /api/tools` | статусы (система/per-runtime/MCP/дашборды) + менеджер; обновляет `tools.env`, запускает autostart-сервисы |
| `PUT /api/tools {packageManager}` | выбор Bun/NPM |
| `POST /api/tools/action` | `install` / `uninstall` / `reinstall` / `toggle` (+`dryRun` - превью команд) |
| `POST /api/tools/diagnose` | проверки работоспособности + промпт исправления |
| `POST /api/tools/dashboard` | `start` / `stop` автономного инстанса; `autostart {enabled}` |
| `GET /api/tools/job?jobId=` | SSE-стрим job'а (файловый лог) |
| `POST /api/tools/job/input` | stdin job'а |
| `GET /api/tools/usage` | события + внешние метрики |

После сторонних установщиков (graphify/rtk/headroom правят конфиги рантаймов) консоль инвалидирует кеш дашборда - если guard-хук рантайма пострадал, это видно во вкладке "Диагностика".

## Инициализация проекта и pre-commit обновление

Serena и CodeGraph индексируют **все рабочие папки** (общий контекст из всех директорий): кнопка **"Инициализировать"** (`POST /api/tools/action {action:"init"}`) строит шаги для каждой папки (`serena project index`, `codegraph init`, cwd шага = папка); то же добавляется в install-цепочку при установке. Graphify собирает граф каждой рабочей папки в **хранилище воркспейсов** консоли: `graphify extract <папка> --code-only --out graphify/<имя>/` (шаг выполняется с cwd = папка, граф пишется в `graphify/<имя>/graphify-out/`; `graphify update` для хранилища не применяется - повторный `extract` инкрементален по manifest-гейту). Когда все папки проинициализированы, кнопка становится **"Переинициализировать"** (пересборка: `codegraph index`, повторный `graphify extract`, переиндексация Serena). OpenWiki собирается **на русском языке**: `openwiki --language ru --init/--update "Веди вики на русском языке."` (core/memory.ts). Далее индексы обновляет **husky pre-commit** (husky 9.1.7, `.husky/pre-commit` → `tooling/scripts/pre-commit-tools.sh`): находит артефакты индексации в корне репозитория (`graphify-out/graph.json` - интеграционный граф самого репозитория, `.serena/project.yml`, `.codegraph/`) и обновляет их - best-effort (коммит не блокируется). Обход: `SKIP_TOOLS_UPDATE=1 git commit …`. Артефакты: `.codegraph/`, `graphify-out/` (любой уровень), `graphify/` (хранилище воркспейсов) - в .gitignore; `.serena/` (project.yml + memories) - можно коммитить. Graphify `--code-only` - локальный AST без LLM-ключа; полный режим с doc-файлами требует API-ключ (GEMINI/ANTHROPIC/OPENAI/…).

**OpenWiki без ключа** - кнопка "через runtime ★": сборка поручается headless-рантайму по умолчанию (его окружение может содержать LLM-ключ); промпт включает команду `openwiki --init/--update` и папку. Изоляция сборок: артефакты openwiki пишутся в `<папка>/openwiki/`, графы Graphify - в `graphify/<имя>/graphify-out/` хранилища - сборки из разных директорий не перезатирают друг друга; публикация графов - по слагу папки.

## Хуки индексов (tooling/harness)

Событийные хуки Serena, CodeGraph и Graphify не вызывают CLI напрямую - только обёртку `tooling/harness/src/cli.ts` с проверкой `command -v bun`. Единый источник списка - реестр `tooling/harness/src/registry.ts`; файлы хуков рантаймов только вызывают обёртку. Покрытие:

- **Claude** (`.claude/settings.json`) - полный набор: PreToolUse x3, UserPromptSubmit (prompt-hook), SessionStart и SessionEnd (Serena);
- **ZCode** (`.zcode/config.json`) - те же записи без SessionEnd; события: SessionStart, UserPromptSubmit, PreToolUse;
- **Cursor** (`.cursor/hooks.json`) - один агрегатор `pretooluse` на событии preToolUse: формат без матчеров, фильтрация по tool_name внутри обёртки;
- **Kimi** (`.kimi/config.toml` + зеркало `~/.kimi-code/config.toml`) - PreToolUse x3 через `sh -c` с проверкой наличия обёртки (чужие проекты - молча exit 0);
- **Codex** (`.codex/hooks.json`) и **OpenCode** (`.opencode/plugins/`) - без хуков индексов (S-4, G-4): additionalContext отклоняется, правила в AGENTS.md.

- **Генерация**: `bun tooling/harness/src/cli.ts docs --write` приводит файлы хуков к реестру (чужие записи, например guard, не трогаются; вызовы индексных инструментов из Codex удаляются - S-4, G-4: Codex ориентируется на правила AGENTS.md);
- **Проверка**: `bun run validate:hooks` падает при прямом вызове `codegraph`/`graphify`/`serena-hooks` в файлах хуков или расхождении с реестром; входит в `bun run tooling/scripts/src/verify.ts verify-fast`;
- **Бюджеты**: SessionStart - 2 с; PreToolUse - 200 мс в среднем на вызов; UserPromptSubmit - 3 с и 4 КБ. prompt-hook обрезает вывод с подписью "call codegraph_explore for the rest" (C-1), пропускает промпты с префиксами `<bash-input>`, `<bash-stdout>`, `<task-notification>` и короче 15 символов (C-2), при живом `.codegraph/writer.pid` выдаёт одну строку про PID вместо контекста (C-3);
- **Graphify guard**: search действует, только когда поиск - первая команда конвейера (`ps aux | grep x` молчит, `grep -rn x .` действует); read - не чаще раза на 10 чтений и молчит после `graphify query` в сессии; состояние - `.agents/.tmp/hooks/<session>/`;
- **Serena**: SessionStart вызывает `serena-hooks activate` только при наличии `.serena/project.yml` (без serena-hooks - встроенная подсказка); remind - для `.ts`/`.tsx` больше 300 строк, один раз за сессию; `auto-approve` не подключается (S-3);
- **Ни один хук не блокирует вызов**: обёртка всегда завершается с кодом 0, ошибка инструмента - пустой вывод;
- **Журнал**: `.agents/.tmp/hooks/hooks.log`, строка `<iso> <hook> <ms> <bytes> exit=<n>`; проверка бюджетов за 7 дней - `bun run harness-doctor run` (hook-budget);
- **Установка**: шаги установщиков codegraph, graphify, serena в консоли не меняют файлы хуков - они восстанавливаются после шага (core/toolJobs.ts); `codegraph init`/`index` идут через обёртку `tooling/mcp/codegraph.ts` - база не открывается при живом writer.pid (C-4);
- **Замер**: `bun tooling/harness/bench/prompt-hook-bench.ts` - 20 промптов; средний вывод обёртки в 2,5 раза меньше прямого вызова, контекст структурных вопросов сохранён.

## Диспетчер tool.sh (для агентов)

```
bash tooling/scripts/tool.sh status        # qmd on, serena off, graphify missing…
bash tooling/scripts/tool.sh <id> <args…>  # запуск CLI-инструмента
```

Состояние - `.agents/console/tools.env` (`TOOL_<ID>=on|off`; нет строки - скрипт проверяет `which`). Контракт: exit 0 - вывод инструмента; **exit 3 + `TOOL_UNAVAILABLE <id>: <подсказка>`** - не установлен/выключен → обычный порядок работы. Правила вызова - `AGENTS.md §10`.

## Graphify во вкладке "Знание"

Тоггл Graphify в "Рабочих папках" (`state.workspaces.graphify`) включает папку в сборку графов. Граф каждой папки - отдельный **воркспейс** в хранилище `graphify/<имя>/graphify-out/` (имя - basename папки; при совпадении имён у нескольких папок - суффикс `-` + 4 символа sha256 полного пути, `graphifyWorkspaceNames` в core/graphify.ts): "Собрать"/"Обновить" выполняет цепочку `graphify extract <папка> --out graphify/<имя>/ && graphify cluster-only graphify/<имя> --no-label` (detached-процесс, лог `graphify-out/.console-build.log`, pid в `.console-build.json`; повторный extract инкрементален - manifest-гейт CLI). extract CLI 0.9.73 пишет только `graph.json`; `graph.html` и `GRAPH_REPORT.md` создаёт cluster-only - без него публиковать граф нечего. "Опубликовать" копирует `graphify-out/graph.html` в `public/graphify/<sha256-slug12>/index.html` → iframe с того же origin; GET-статус публикует существующие графы автоматически. Счётчики узлов/рёбер - из `graph.json` (лимит разбора 8 МБ). vis-network грузится с unpkg - просмотр требует интернета, сборка локальная (tree-sitter, без LLM).

Кнопка **"Wiki"** собирает wiki из графа папки: `graphify export wiki --graph graphify/<имя>/graphify-out/graph.json` - статьи markdown в `graphify-out/wiki/` (`index.md` - точка входа; detached-процесс, лог `.console-wiki.log`, pid в `.console-wiki.json`, задача "wiki Graphify" в Мониторинге; при идущей сборке графа запуск wiki отклоняется - 409). Кнопка **"Статьи wiki"** открывает просмотр: дерево статей слева (из `graphifyWikiTree`, hidden-файлы исключены), markdown справа - чтение идёт через `GET /api/memory/file`, корни `graphify/<имя>/graphify-out/wiki` добавлены в открытые корни политики чтения. Имена статей берутся из `.graphify_labels.json` (появляются при полной сборке с LLM-бэкендом, кнопка "через runtime ★"; локальная цепочка идёт с `--no-label`); без меток - `Community_N`.

Запросы агентов к графам идут по целевой папке: `graphify query "<вопрос>" --graph graphify/<имя>/graphify-out/graph.json` (правило - `AGENTS.md §10`); интеграционный граф самого репозитория - `graphify-out/graph.json` в корне (setup.sh, pre-commit).

## LLM-провайдеры сборок (OpenWiki, Graphify)

OpenWiki и Graphify конфигурируются пресетами провайдеров - шестерёнка в карточке инструмента ("Настройки → Инструменты") или во вкладке OpenWiki. Пресеты: OpenAI-совместимый (Ollama/vLLM - с base URL), OpenAI, Gemini, Claude, Kimi, DeepSeek (списки - `core/llmPresets.ts`). Конфиг - `state.openwikiLlm` / `state.graphifyLlm` (ключ - локально, вне git; у Graphify ещё `modelId`); при сборке значения передаются CLI переменными окружения и флагами (OpenWiki: `OPENWIKI_PROVIDER`, `OPENAI_COMPATIBLE_*`, `OPENWIKI_MODEL_ID`; Graphify: env-ключ бэкенда, `--backend` и `--model` из пресета - авто-детект CLI не видит ключ Ollama, а без `--model` берётся дефолт CLI). OpenWiki полностью работает с локальной Ollama - runtime ★ для него не нужен. Модель должна существовать у провайдера (ретирнутые теги cloud-моделей отклоняются).

Альтернатива провайдеру для OpenWiki - **агентская сборка** ("через агент ★" во вкладке OpenWiki): интеграция openwiki для рантайма (`openwiki integrations install <codex|claude|opencode|cursor> --project`) ставит скилл (`<repo>/.agents/skills/openwiki` для codex, `.claude/.opencode/.cursor/skills/openwiki` для остальных) и MCP-запись (`openwiki mcp --host <id>` в `.mcp.json` / `.codex/config.toml` / `opencode.jsonc` / `.cursor/mcp.json`); страницы пишет сам агент своей моделью, без LLM-ключей openwiki. Состояние интеграций - `openwiki integrations list --project`; MCP-синк консоли эти записи не трогает (правило managed-имён).

## Дашборды (Serena :24282, Headroom :8787, AgentPlane :24287)

Дашборд работает, только пока запущен сам инструмент: Serena запускает его вместе с MCP-сервером (сессия агента), Headroom - вместе с прокси, AgentPlane - автономной командой. Кнопка "Дашборд" открывает модалку с проверкой доступности (TCP-проба порта с сервера - соединение без HTTP-запроса) и iframe'ом (страницу грузит браузер). Дашборд Headroom в iframe получает данные через `/headroom-api/*` (fetch-shim направляет root-relative запросы `/stats`, `/health`, ... на роут-прокси); если через прокси не прошёл ни один LLM-запрос, счётчики нулевые - модалка показывает команду запуска сессий через прокси (`headroom wrap <runtime>`). Если дашборд не запущен - кнопка "Запустить автономный инстанс": detached-процесс (`serena start-mcp-server --transport streamable-http --port 9121 --enable-web-dashboard true --open-web-dashboard false` / `headroom proxy --port 8787` / `agentplane context dashboard --host 127.0.0.1 --port 24287`), pid - в `.agents/console/dashboards.json`, лог - `.agents/console/logs/<id>-dashboard.log`, остановка - кнопкой в модалке. Флаг `--enable-web-dashboard` перекрывает конфиг пользователя (`web_dashboard: false` в `~/.serena/serena_config.yml` не мешает автономному инстансу; сам конфиг консоль не правит). Запущенные сессиями агентов дашборды тоже определяются пробой порта, но консоль их не останавливает.

Дашборд AgentPlane - read-only просмотр графа знания (`agentplane context dashboard`): вики-страницы, wikilinks, сущности, факты и evidence задач из `.agentplane` workspace корня репозитория (без `.agentplane` граф пустой - инициализация: `agentplane init --quick` в корне). Заголовков блокировки встраивания сервер не ставит - iframe прямой, embed-прокси не нужен.

**Автозапуск** - Toggle в правом нижнем углу карточки Serena/Headroom (`state.tools.autostart`): включение немедленно запускает инстанс (если порт не отвечает), выключение - останавливает консольный; далее консоль поддерживает сервис запущенным при обращениях к `/api/tools` (ленивый запуск, повторные попытки не чаще раза в 30 с).

**Вывод job'ов установки** пишется на диск - `.agents/console/tool-jobs/<id>.log` + `.json` (статус), SSE-роут `/api/tools/job` читает файлы: источник инвариантен к HMR и границам route-бандлов (in-memory Map в dev пуста в соседнем бандле - это и давало вечное "ожидание вывода").

## Обновление (Настройки → Обновить)

Реестр зависимостей harness - `.agents/console/updates.json` (`core/updates.ts`): локальные npm-пакеты workspace (deps+devDeps корня и проектов из поля `workspaces`; протоколы `workspace:`/`link:`/`file:`/`catalog:` и внутренние `@harness/*` пропускаются) и глобальные инструменты (npm-глобальные по выбору Bun/NPM, uv-инструменты, bun, node, uv, rtk - только установленные). Открытие вкладки синхронизирует реестр без сети: появившийся инструмент добавляется, удалённый - удаляется, статусы запусков сохраняются. Кнопка "Проверить наличие обновлений" опрашивает реестры npm и PyPI, GitHub releases и `brew outdated` (перед ним `brew update`), записывает свежие версии и дату проверки; устаревшие записи подсвечиваются и открываются в модалке выбора. Запуск обновления выполняет команды выбранных записей одним job'ом (`core/toolJobs.ts`, шаги с `stepId`, все optional - неудача одной записи не останавливает остальные); по завершении в реестр пишутся статус (успех/ошибка) и время, строки подсвечиваются зелёным/красным. Команды обновления строит только сервер из реестра - клиент присылает идентификаторы записей. Инструменты, не управляемые brew, помечаются "обновление вручную" и без команды.

## Статистика использования

`.agents/console/tools-usage.json`: события консоли (install/uninstall/ reinstall/toggle/build/graph/index/pm; лимит 1000) + снапшоты внешних метрик не чаще раза в 5 минут - **только CLI/файлы** (`rtk gain --format json --all`, `~/.headroom/proxy_savings.json` / `headroom savings`). Серверных HTTP-запросов на локальные порты консоль не делает; дашборды Serena/Headroom открываются iframe прямо из браузера (кнопка "Дашборд").

## Безопасность

- Установочные команды - литеральные массивы из реестра `core/tools.ts`; spawn без оболочки; пути валидируются; MCP-имена - существующий `isValidMcpName`.
- Внешние инсталлеры в setup.sh скачиваются в `.agents/.tmp/setup/` и запускаются файлами (без `curl | bash`).
- Дашборды инструментов (Serena :24282, Headroom :8787, AgentPlane :24287) не аутентифицированы - слушают loopback. Serena и AgentPlane встраиваются iframe напрямую; Headroom ставит `x-frame-options: DENY`, поэтому его iframe грузится через embed-прокси консоли (`/dashboard/*` → `127.0.0.1:8787/dashboard/*`): апстрим - литерал из кода (не пользовательский ввод), только GET, из ответа снимаются заголовки фрейминга, в HTML инжектится fetch-shim. Данные дашборда Headroom идут через `/headroom-api/*` (GET|POST → `127.0.0.1:8787/*`, путь 1:1, те же ограничения). Прямой URL остаётся кнопкой "открыть в новой вкладке".

## Правило поддержки

Новый внешний инструмент - той же серией коммитов: `core/tools.ts` + `tool.sh` + `setup.sh` + этот документ + таблица в `AGENTS.md §10`.
