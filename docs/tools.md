# Инструменты экономии контекста

Реестр внешних инструментов (Serena, qmd, CodeGraph, Graphify, RTK, Headroom, OpenWiki, Open Design, AgentPlane, CodeBurn и связки памяти: Neo4j, LightRAG, Qdrant). Канонические места:

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
| [AgentPlane](https://github.com/basilisk-labs/agentplane) | PM: `… agentplane` | нет | граф знания и lifecycle задач | дашборд `127.0.0.1:24287` (iframe); Stats: readiness, задачи по статусам, активная работа (`task active`) |
| [CodeBurn](https://github.com/getagentseal/codeburn) | PM: `bun add -g codeburn` / `npm i -g` | нет | нет | данные отчёта CodeBurn (вкладка "Оптимизация"; без инструмента - null-state) |
| [Neo4j](https://neo4j.com/docs/) | `brew install neo4j` (macOS; linux - вручную) | да (`uvx mcp-neo4j-memory`; env `NEO4J_*`) | нет (MCP-реестр) | сервис `neo4j console` + Browser `127.0.0.1:7474`; Bolt `:7687` |
| [LightRAG](https://github.com/HKUDS/LightRAG) | `uv tool install "lightrag-hku[api,offline-llm,offline-storage]"` | нет (OpenAI-совместимый API + WebUI) | нет | сервис `lightrag-server`, WebUI `127.0.0.1:9621`; граф - в Neo4j |
| [Qdrant](https://qdrant.tech/documentation/) | релиз GitHub в `~/.local/opt/qdrant` + симлинк в `~/.local/bin` (macOS; brew-формулы нет) | да (`uvx mcp-server-qdrant`; env `QDRANT_URL`, `COLLECTION_NAME`) | нет (MCP-реестр) | сервис `qdrant`, WebUI `127.0.0.1:6333/dashboard`; gRPC `:6334` |

Unsupported-матрица per-runtime (детали - `core/tools.ts`):

- **CodeGraph**: нет kimi/zcode (MCP доступен через проектные файлы: `.mcp.json` - claude/kimi, `.agents/mcp.json` - zcode, см. [mcp.md](mcp.md));
- **RTK** (по `rtk init --help` 0.39.x): нет zcode (rtk-ai/rtk#2898) и codex (флага `--codex` в `rtk init` нет; opencode - отдельный флаг `--opencode`; kimi - project-scoped, правила пишутся в AGENTS.md репозитория; префикс `rtk <cmd>` работает и без хука). **Project-uninstall**: RTK не умеет снимать project-scope ("manually remove RTK from CLAUDE.md") - при uninstall из консоли зачистка программная: маркерные блоки `<!-- rtk-instructions -->` из CLAUDE.md/AGENTS.md и файлы `.rtk/filters.toml`, `.opencode/plugins/rtk.ts`, `.claude/RTK.md`;
- **Headroom wrap**: cursor - вручную (`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`);
- **Graphify**: zcode - generic-платформа `agents` (skill в `~/.agents/skills`, при project-scope - `./.agents/skills/`);
- **Nx**: per-runtime интеграций нет - чистый CLI для проектов с `nx.json`; в этом репозитории вызывается внутри `verify.ts` (кеш `.nx/`, `nx.json` + `project.json` проектов; AGENTS.md §7). Команду `nx configure-ai-agents` не запускать - конфигурация агентов ведётся в harness;
- **Open Design**: Console проверяет `od mcp --help`. Актуальный контракт использует `--daemon-url`. Legacy `od mcp install <agent>` применяется только при наличии команды в help. Детект `which od` может найти системный octal-dump, поэтому проверка требует capability `--daemon-url`.

## Связки памяти (Знание → Связки)

Связки - группы инструментов памяти, ставимые одной задачей (`TOOL_COMBOS` в `core/tools.ts`; установка - `POST /api/tools/action {action:"install", comboId}`). Шаги - конкатенация install-цепочек членов (`buildComboInstallSteps` в `core/toolActions.ts`), установленные части пропускаются: общий Neo4j двух связок ставится один раз. Карточки связок - вкладка "Связки" раздела "Знание"; компоненты управляются по отдельности в "Настройках → Инструменты".

| Связка | Компоненты | Назначение |
|---|---|---|
| `neo4j-lightrag` | Neo4j + LightRAG | графовая память: knowledge graph в Neo4j и графовый RAG (LightRAG хранит граф в Neo4j: `LIGHTRAG_GRAPH_STORAGE=Neo4JStorage`) |
| `neo4j-qdrant` | Neo4j + Qdrant | гибридная память агентов: MCP `mcp-neo4j-memory` (сущности/отношения) + MCP `mcp-server-qdrant` (семантический поиск; эмбеддинги - локальный fastembed, ключ не нужен) |

Сервисы ставятся нативно (Neo4j - brew на macOS, Qdrant - официальный бинарник из GitHub Releases в `~/.local/opt/qdrant`, LightRAG - uv) и запускаются консолью как автономные инстансы (запуск/остановка кнопкой во вкладке "Связки" или "Настройки → Инструменты"; PID - `dashboards.json`, данные - `.agents/console/services/<id>/`): `neo4j console` (Browser `:7474`, Bolt `:7687`), `qdrant` (REST/WebUI `:6333`, gRPC `:6334`, адрес `127.0.0.1`), `lightrag-server` (API/WebUI `:9621`, адрес `127.0.0.1`). Все порты - только localhost.

Требования и нюансы:

- **Neo4j**: установка выполняет `neo4j-admin dbms set-initial-password harness-memory` (локальный пароль; смена - той же командой). MCP-сервер `mcp-neo4j-memory` использует те же учётные данные (env `NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD` в пресете);
- **LightRAG**: без настроенного LLM-биндинга сервер не стартует. Биндинг - шестерёнка в строке LightRAG (вкладка "Связки" или карточка инструмента): пресеты Ollama (локальный, по умолчанию), OpenAI, OpenAI-совместимый (`state.lightragLlm`; env `LLM_BINDING`, `LLM_BINDING_HOST`, `LLM_BINDING_API_KEY`, `EMBEDDING_*` - `core/lightragLlm.ts`). KV, векторы и статус документов - файлы рабочего каталога сервиса;
- **Qdrant**: версия зафиксирована в плагине (`QDRANT_VERSION` - при новом релизе обновить); `~/.local/bin` должен быть в PATH (детекция `which qdrant`). MCP-пресет использует `QDRANT_URL=http://127.0.0.1:6333` и коллекцию `harness-memory` (создаётся при первой записи);
- Linux: brew и релизы darwin недоступны - консоль вернёт ошибку с ручной командой (systemInstall возвращает null; Linux-сборки Qdrant - в релизах проекта).

## Пакетный менеджер npm-пакетов (Bun | NPM)

Выбор делает `setup.sh` (вопрос при первом запуске; default - Bun) или Select в разделе "Инструменты". Хранится в `.agents/console/package-manager.json`, применяется к: установке npm-инструментов (`bun add -g` ↔ `npm install -g`) и stdio-пресетам MCP каталога (`bunx <pkg>` ↔ `npx -y <pkg>`; уже установленные серверы не перезаписываются).

## Хуки жизненного цикла

Определение инструмента (ToolDef в `core/tools/<id>.ts`) может объявить `hooks: {install?, remove?, enable?, disable?}` - списки shell-команд. Исполнение - общее с навыками, MCP и плагинами (`core/lifecycleHooks.ts`): guard-проверка репозитория, `bash -c`, cwd = обязательная рабочая папка (write mode), таймаут 60 с, лог `.agents/console/hooks/tool.log`. install - после успешной установки/переустановки (включая синхронный путь без job), remove - до зачистки при uninstall, enable/disable - на toggle (оба пути: синхронный и job). Ошибки хуков в лог домена; ответ задачи их не блокирует.

## Жизненный цикл (Настройки → Инструменты)

Состояния: `missing` → `on` → `off` (запись `state.tools.installed[id]`: `{runtimes, params, at, enabled}`; для MCP-инструментов отражается в реестре `state.mcp.servers`). Кнопки по состоянию: "Установить" / "Выключить" / "Включить" / "Обновить" / "Переустановить" (uninstall+install с сохранёнными параметрами) / "Удалить" (интеграции + MCP-запись; системный пакет остаётся - команда ручной очистки в подтверждении). Установка - job с SSE-терминалом (`/api/tools/job`), интерактивные установщики получают stdin.

Обновление системного пакета - кнопка "Обновить" (`POST /api/tools/action`, action `update`): один шаг `uv tool upgrade <pkg>` / `brew upgrade <formula>` / `<pm> add -g <pkg>@latest` из `ToolDef.systemUpdate`. Кнопка показывается только у инструментов с командой (qdrant и open-design обновляются вручную). Повторная установка и "Переустановить" версию не поднимают: у установленного пакета шаг "Системный пакет" пропускается, а `uv tool install` уже установленного - no-op. Массовая проверка свежих версий по всем зависимостям - вкладка "Настройки → Обновить" (`core/updates.ts`); новый инструмент регистрируется в обоих местах (docs/tools-dev.md).

Нюансы uninstall/reinstall:

- шаги снятия - **optional**: "нечего снимать" или каприз CLI не ломает переустановку (uninstall-код не останавливает цепочку);
- RTK: `--uninstall` работает только с `-g` для любых агентов (проверено на CLI 0.39.x); project-снятие CLI не умеет - консоль зачищает программно (блоки `<!-- rtk-instructions -->` в CLAUDE.md/AGENTS.md и файлы `.rtk/filters.toml`, `.opencode/plugins/rtk.ts`, `.claude/RTK.md`);
- Headroom: uninstall останавливает прокси-инстанс и сбрасывает autostart (`uninstallStopsDashboard`);
- в запись `installed` мержатся интеграции, найденные маркерами на диске - uninstall/reinstall не теряет внешние/ранние установки.

**Диагностика** - кнопка в карточке (`POST /api/tools/diagnose`): проверки CLI, зависимостей, per-runtime интеграций, MCP-реестра, доступности дашборда (TCP-проба) и хуков (RTK). Символы: `✓` ок, `✗` критичный провал, `-` информационно. При критичных провалах формируется промпт headless-исправления - кнопка "Исправить" отправляет его в `/api/prompts/run` (рантайм задачи "Исполнение команд").

API:

| Роут | Назначение |
|---|---|
| `GET /api/tools` | статусы (система/per-runtime/MCP/дашборды), связки (`combos`) + менеджер; обновляет `tools.env`, запускает autostart-сервисы |
| `PUT /api/tools {packageManager}` | выбор Bun/NPM |
| `POST /api/tools/action` | `install` / `uninstall` / `reinstall` / `toggle` / установка связки `{action:"install", comboId}` (+`dryRun` - превью команд) |
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

## Аудит доставки навыков и настройки рантайма

- `bun tooling/harness/src/cli.ts skill-links` - JSON-аудит доставки навыков в каталоги рантаймов: классификация записей (`link` / `mirror` / `real` / `broken` / `other`) с целями ссылок и маркеров зеркал, перечень сгенерированных команд (маркер `<!-- generated by harness console -->`). Сканер автономен от кода консоли (`tooling/harness/src/skill-links.ts`); карты каталогов синхронны с `core/skillRegistry.ts` (RUNTIME_SKILL_DIRS) и `core/commandSync.ts`.
- `bun .guardrails/src/cli.ts context` - машиночитаемые (JSON) настройки активного рантайма: адаптер, профиль, модели по тирам, лимиты и verification-команды; для консоли и headless-запусков. Текстовый эквивалент - команда `settings` (вывод AGENTS.md §2).

## Диспетчер tool.sh (для агентов)

```
bash tooling/scripts/tool.sh status        # qmd on, serena off, graphify missing…
bash tooling/scripts/tool.sh <id> <args…>  # запуск CLI-инструмента
```

Состояние - `.agents/console/tools.env` (`TOOL_<ID>=on|off`; нет строки - скрипт проверяет `which`). Контракт: exit 0 - вывод инструмента; **exit 3 + `TOOL_UNAVAILABLE <id>: <подсказка>`** - не установлен/выключен → обычный порядок работы. Правила вызова - `AGENTS.md §10`.

## Graphify во вкладке "Знание"

Тоггл Graphify в "Workspaces" (`state.workspaces.graphify`) включает папку в сборку графов. Граф каждой папки - отдельный **воркспейс** в хранилище `graphify/<имя>/graphify-out/` (имя - basename папки; при совпадении имён у нескольких папок - суффикс `-` + 4 символа sha256 полного пути, `graphifyWorkspaceNames` в core/graphify.ts): "Собрать"/"Обновить" выполняет цепочку `graphify extract <папка> --out graphify/<имя>/ && graphify cluster-only graphify/<имя> --no-label` (detached-процесс, лог `graphify-out/.console-build.log`, pid в `.console-build.json`; повторный extract инкрементален - manifest-гейт CLI). extract CLI 0.9.73 пишет только `graph.json`; `graph.html` и `GRAPH_REPORT.md` создаёт cluster-only - без него публиковать граф нечего. "Опубликовать" копирует `graphify-out/graph.html` в `public/graphify/<sha256-slug12>/index.html` → iframe с того же origin; GET-статус публикует существующие графы автоматически. Счётчики узлов/рёбер - из `graph.json` (лимит разбора 8 МБ). vis-network грузится с unpkg - просмотр требует интернета, сборка локальная (tree-sitter, без LLM).

Кнопка **"Wiki"** собирает wiki из графа папки: `graphify export wiki --graph graphify/<имя>/graphify-out/graph.json` - статьи markdown в `graphify-out/wiki/` (`index.md` - точка входа; detached-процесс, лог `.console-wiki.log`, pid в `.console-wiki.json`, задача "wiki Graphify" в Мониторинге; при идущей сборке графа запуск wiki отклоняется - 409). Кнопка **"Статьи wiki"** открывает просмотр: дерево статей слева (из `graphifyWikiTree`, hidden-файлы исключены), markdown справа - чтение идёт через `GET /api/memory/file`, корни `graphify/<имя>/graphify-out/wiki` добавлены в открытые корни политики чтения. Имена статей берутся из `.graphify_labels.json` (появляются при полной сборке с LLM-бэкендом, кнопка "через runtime ★"; локальная цепочка идёт с `--no-label`); без меток - `Community_N`.

Запросы агентов к графам идут по целевой папке: `graphify query "<вопрос>" --graph graphify/<имя>/graphify-out/graph.json` (правило - `AGENTS.md §10`); интеграционный граф самого репозитория - `graphify-out/graph.json` в корне (setup.sh, pre-commit).

Блок **"All-in-One"** вверху вкладки объединяет собранные графы папок в один: источники - `graphify/<имя>/graphify-out/graph.json` включённых папок (несобранные пропускаются), сборка - `graphify merge-graphs <источники> --out graphify-out/all-in-one/graphify-out/graph.json && graphify cluster-only graphify-out/all-in-one --no-label` (кнопкой блока; detached-процесс, лог и pid - `.console-build.log`/`.console-build.json` каталога all-in-one, задача "Сборка All-in-One" в Мониторинге). merge-graphs принимает два и более графа; один источник - копия его `graph.json`. merge-graphs помечает узлы атрибутом `repo` (тег источника); повторная сборка передаёт `--previous` - community id объединённого графа сохраняются между сборками. Каталог all-in-one - виртуальный воркспейс внутри корневого `graphify-out/`: интеграционный граф репозитория блок не затрагивает. Публикация и wiki - механика папок без изменений: graph.html - в `public/graphify/<slug12>/index.html` (GET-статус публикует автоматически), wiki (`graphify export wiki`, кнопка "Wiki") - в `graphify-out/all-in-one/graphify-out/wiki/` (корень добавлен в открытые корни `GET /api/memory/file`). Запуск - POST `/api/memory/graphify/merge` (`{wiki: true}` - сборка wiki). Запросы агентов к объединённому графу: `graphify query "<вопрос>" --graph graphify-out/all-in-one/graphify-out/graph.json`.

## LLM-провайдеры сборок (OpenWiki, Graphify, LightRAG)

OpenWiki, Graphify и LightRAG конфигурируются пресетами провайдеров - шестерёнка в карточке инструмента ("Настройки → Инструменты") или во вкладках OpenWiki/Связки. Пресеты: OpenAI-совместимый (Ollama/vLLM - с base URL), OpenAI, Gemini, Claude, Kimi, DeepSeek (списки - `core/llmPresets.ts`; LightRAG - `LIGHTRAG_PRESETS`). Конфиг - `state.openwikiLlm` / `state.graphifyLlm` / `state.lightragLlm` (ключ - локально, вне git; у Graphify и LightRAG ещё `modelId`); при сборке/старте значения передаются CLI переменными окружения и флагами (OpenWiki: `OPENWIKI_PROVIDER`, `OPENAI_COMPATIBLE_*`, `OPENWIKI_MODEL_ID`; Graphify: env-ключ бэкенда, `--backend` и `--model` из пресета - авто-детект CLI не видит ключ Ollama, а без `--model` берётся дефолт CLI; LightRAG: `LLM_BINDING`/`EMBEDDING_BINDING` и хост/ключ из пресета - `core/lightragLlm.ts`). OpenWiki и LightRAG полностью работают с локальной Ollama - runtime ★ для них не нужен. Модель должна существовать у провайдера (ретирнутые теги cloud-моделей отклоняются).

Альтернатива провайдеру для OpenWiki - **агентская сборка** ("через агент ★" во вкладке OpenWiki): интеграция openwiki для рантайма (`openwiki integrations install <codex|claude|opencode|cursor> --project`) ставит скилл (`<repo>/.agents/skills/openwiki` для codex, `.claude/.opencode/.cursor/skills/openwiki` для остальных) и MCP-запись (`openwiki mcp --host <id>` в `.mcp.json` / `.codex/config.toml` / `opencode.jsonc` / `.cursor/mcp.json`); страницы пишет сам агент своей моделью, без LLM-ключей openwiki. Состояние интеграций - `openwiki integrations list --project`; MCP-синк консоли эти записи не трогает (правило managed-имён).

## Дашборды (Serena :24282, Headroom :8787, AgentPlane :24287, Neo4j :7474, Qdrant :6333, LightRAG :9621)

Дашборд работает, только пока запущен сам инструмент: Serena запускает его вместе с MCP-сервером (сессия агента), Headroom - вместе с прокси, AgentPlane - автономной командой, Neo4j/Qdrant/LightRAG - сервисы связок памяти (запуск кнопкой, данные - `.agents/console/services/<id>/`). Кнопка "Дашборд" открывает модалку с проверкой доступности (TCP-проба порта с сервера - соединение без HTTP-запроса) и iframe'ом (страницу грузит браузер). Дашборд Headroom в iframe получает данные через `/headroom-api/*` (fetch-shim направляет root-relative запросы `/stats`, `/health`, ... на роут-прокси); если через прокси не прошёл ни один LLM-запрос, счётчики нулевые - модалка показывает команду запуска сессий через прокси (`headroom wrap <runtime>`). Если дашборд не запущен - кнопка "Запустить автономный инстанс": detached-процесс (`serena start-mcp-server --transport streamable-http --port 9121 --enable-web-dashboard true --open-web-dashboard false` / `headroom proxy --port 8787` / `agentplane context dashboard --host 127.0.0.1 --port 24287` / `neo4j console` / `qdrant` / `lightrag-server`), pid - в `.agents/console/dashboards.json`, лог - `.agents/console/logs/<id>-dashboard.log`, остановка - кнопкой в модалке. Флаг `--enable-web-dashboard` перекрывает конфиг пользователя (`web_dashboard: false` в `~/.serena/serena_config.yml` не мешает автономному инстансу; сам конфиг консоль не правит). Запущенные сессиями агентов дашборды тоже определяются пробой порта, но консоль их не останавливает.

Дашборд AgentPlane - read-only просмотр графа знания (`agentplane context dashboard`): вики-страницы, wikilinks, сущности, факты и evidence задач из `.agentplane` workspace корня репозитория (без `.agentplane` граф пустой - инициализация: `agentplane init --quick` в корне). Заголовков блокировки встраивания сервер не ставит - iframe прямой, embed-прокси не нужен.

## AgentPlane в Harness

Консоль использует AgentPlane (CLI `agentplane`) в трёх ролях:

- **Мониторинг** (вкладка "Оптимизация", карточка AgentPlane; `core/tools/agentplane-status.ts`): `preflight --json --mode quick` (readiness), `task list` (счётчики по статусам) и `task active --json` (активная работа: следующий шаг супервизора, блокеры, ожидание ответа пользователя). Агенты вызывают CLI через `tool.sh agentplane <args>`.
- **Синк roadmap** (`core/workflows/agentplane.ts`): задачи roadmap workflow создаются и обновляются в `.agentplane` workspace командами `task add` / `task update` (детерминированный id `YYYYMMDDHHMM-XXXX`, идемпотентно).
- **Граф знания**: read-only дашборд (см. "Дашборды").

Не используется консолью (доступно агентам напрямую через `tool.sh agentplane`): kernel-lifecycle задач (`task create` → `task advance`), `task brief` / `task run`, план-гейтинг (`task plan`), `task ask` / `task answer`, очередь интеграции веток (`integrate queue`, `pr`).

Ограничение (AgentPlane 0.7.x): `task complete` требует записанного результата верификации (kernel-lifecycle), поэтому закрытие roadmap-задачи в AgentPlane при переводе её в done завершается ошибкой - detail содержит подсказку CLI ("Fix: agentplane task advance ..."). Синк best-effort: roadmap не ломается; остальное (создание, обновление, метаданные) работает.

**Автозапуск** - Toggle в правом нижнем углу карточки Serena/Headroom (`state.tools.autostart`): включение немедленно запускает инстанс (если порт не отвечает), выключение - останавливает консольный; далее консоль поддерживает сервис запущенным при обращениях к `/api/tools` (ленивый запуск, повторные попытки не чаще раза в 30 с).

**Вывод job'ов установки** пишется на диск - `.agents/console/tool-jobs/<id>.log` + `.json` (статус), SSE-роут `/api/tools/job` читает файлы: источник инвариантен к HMR и границам route-бандлов (in-memory Map в dev пуста в соседнем бандле - это и давало вечное "ожидание вывода").

## Обновление (Настройки → Обновить)

Реестр зависимостей harness - `.agents/console/updates.json` (`core/updates.ts`): локальные npm-пакеты workspace (deps+devDeps корня и проектов из поля `workspaces`; протоколы `workspace:`/`link:`/`file:`/`catalog:` и внутренние `@harness/*` пропускаются) и глобальные инструменты (npm-глобальные openwiki, qmd, codegraph, nx, agentplane, codeburn - по выбору Bun/NPM; uv-инструменты serena-agent, graphifyy, headroom-ai, lightrag-hku; brew-формулы uv, node, rtk, neo4j; bun - только установленные). Открытие вкладки синхронизирует реестр без сети: появившийся инструмент добавляется, удалённый - удаляется, статусы запусков сохраняются. Кнопка "Проверить наличие обновлений" опрашивает реестры npm и PyPI, GitHub releases и `brew outdated` (перед ним `brew update`), записывает свежие версии и дату проверки; устаревшие записи подсвечиваются и открываются в модалке выбора. Запуск обновления выполняет команды выбранных записей одним job'ом (`core/toolJobs.ts`, шаги с `stepId`, все optional - неудача одной записи не останавливает остальные); по завершении в реестр пишутся статус (успех/ошибка) и время, строки подсвечиваются зелёным/красным. Команды обновления строит только сервер из реестра - клиент присылает идентификаторы записей. Инструменты, не управляемые brew, помечаются "обновление вручную" и без команды. Точечное обновление одного инструмента - кнопка "Обновить" в разделе "Инструменты" (см. выше).

## Статистика использования

`.agents/console/tools-usage.json`: события консоли (install/uninstall/ reinstall/toggle/build/graph/index/pm; лимит 1000) + снапшоты внешних метрик не чаще раза в 5 минут - **только CLI/файлы** (`rtk gain --format json --all`, `~/.headroom/proxy_savings.json` / `headroom savings`). Серверных HTTP-запросов на локальные порты консоль не делает; дашборды Serena/Headroom открываются iframe прямо из браузера (кнопка "Дашборд").

## Безопасность

- Установочные команды - литеральные массивы из реестра `core/tools.ts`; spawn без оболочки; пути валидируются; MCP-имена - существующий `isValidMcpName`.
- Внешние инсталлеры в setup.sh скачиваются в `.agents/.tmp/setup/` и запускаются файлами (без `curl | bash`).
- Дашборды инструментов (Serena :24282, Headroom :8787, AgentPlane :24287) не аутентифицированы - слушают loopback. Serena и AgentPlane встраиваются iframe напрямую; Headroom ставит `x-frame-options: DENY`, поэтому его iframe грузится через embed-прокси консоли (`/dashboard/*` → `127.0.0.1:8787/dashboard/*`): апстрим - литерал из кода (не пользовательский ввод), только GET, из ответа снимаются заголовки фрейминга, в HTML инжектится fetch-shim. Данные дашборда Headroom идут через `/headroom-api/*` (GET|POST → `127.0.0.1:8787/*`, путь 1:1, те же ограничения). Прямой URL остаётся кнопкой "открыть в новой вкладке".

## Правило поддержки

Новый внешний инструмент - той же серией коммитов: `core/tools.ts` + `tool.sh` + `setup.sh` + этот документ + таблица в `AGENTS.md §10`.
