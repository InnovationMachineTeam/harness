# Инструменты экономии контекста

Реестр внешних инструментов, экономящих токены агентов (Serena, qmd, CodeGraph, Graphify, RTK, Headroom + OpenWiki). Канонические места:

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
| [Graphify](https://github.com/safishamsi/graphify) | `uv tool install graphifyy` (пакет с двумя "y") | опц. (`python -m graphify.serve`) | `graphify install --platform <p>` | граф - вкладка "Память" |
| [RTK](https://github.com/rtk-ai/rtk) | `brew install rtk` | нет | `rtk init -g [--agent <a>]` | `rtk gain` → статистика |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | `uv tool install --python 3.13 "headroom-ai[all]"` | да (режим mcp) | прокси-сервис (autostart); сессии - `headroom wrap <runtime>` в терминале | дашборд `127.0.0.1:8787` (iframe) |
| [OpenWiki](https://github.com/langchain-ai/openwiki) | PM: `… openwiki` | нет | нет | вкладка "Память" |

Unsupported-матрица per-runtime (детали - `core/tools.ts`):

- **CodeGraph**: нет kimi/zcode (MCP доступен через проектный `.mcp.json`);
- **RTK** (по `rtk init --help` 0.39.x): нет zcode (rtk-ai/rtk#2898) и codex (флага `--codex` в `rtk init` нет; opencode - отдельный флаг `--opencode`; kimi - project-scoped, правила пишутся в AGENTS.md репозитория; префикс `rtk <cmd>` работает и без хука). **Project-uninstall**: RTK не умеет снимать project-scope ("manually remove RTK from CLAUDE.md") - при uninstall из консоли зачистка программная: маркерные блоки `<!-- rtk-instructions -->` из CLAUDE.md/AGENTS.md и файлы `.rtk/filters.toml`, `.opencode/plugins/rtk.ts`, `.claude/RTK.md`;
- **Headroom wrap**: cursor - вручную (`ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`);
- **Graphify**: zcode - generic-платформа `agents` (skill в `~/.agents/skills`, при project-scope - `./.agents/skills/`).

## Пакетный менеджер npm-пакетов (Bun | NPM)

Выбор делает `setup.sh` (вопрос при первом запуске; default - Bun) или Select в разделе "Инструменты". Хранится в `.agents/console/package-manager.json`, применяется к: установке npm-инструментов (`bun add -g` ↔ `npm install -g`) и stdio-пресетам MCP каталога (`bunx <pkg>` ↔ `npx -y <pkg>`; уже установленные серверы не перезаписываются).

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

Serena, CodeGraph и Graphify индексируют **все рабочие папки** (общий контекст из всех директорий): кнопка **"Инициализировать"** (`POST /api/tools/action {action:"init"}`) строит шаги для каждой папки (`serena project index`, `codegraph init`, `graphify extract . --code-only`, cwd шага = папка); то же добавляется в install-цепочку при установке и выполняется в setup.sh. Когда все папки проинициализированы, кнопка становится **"Переинициализировать"** (пересборка: `codegraph index`, `graphify extract` заново, переиндексация Serena). OpenWiki собирается **на русском языке**: `openwiki --language ru --init/--update "Веди вики на русском языке."` (core/memory.ts). Далее индексы обновляет **husky pre-commit** (husky 9.1.7, `.husky/pre-commit` → `tooling/scripts/pre-commit-tools.sh`): находит артефакты индексации (`*/graphify-out/graph.json`, `*/.serena/project.yml`, `*/.codegraph/*`) и обновляет их - best-effort (коммит не блокируется). Обход: `SKIP_TOOLS_UPDATE=1 git commit …`. Артефакты: `.codegraph/`, `graphify-out/` (любой уровень) - в .gitignore; `.serena/` (project.yml + memories) - можно коммитить. Graphify `--code-only` - локальный AST без LLM-ключа; полный режим с doc-файлами требует API-ключ (GEMINI/ANTHROPIC/OPENAI/…).

**OpenWiki без ключа** - кнопка "через runtime ★": сборка поручается headless-рантайму по умолчанию (его окружение может содержать LLM-ключ); промпт включает команду `openwiki --init/--update` и папку. Изоляция сборок: артефакты пишутся в `<папка>/openwiki/` и `<папка>/graphify-out/` - сборки из разных директорий не перезатирают друг друга; публикация графов - по слагу папки.

## Диспетчер tool.sh (для агентов)

```
bash tooling/scripts/tool.sh status        # qmd on, serena off, graphify missing…
bash tooling/scripts/tool.sh <id> <args…>  # запуск CLI-инструмента
```

Состояние - `.agents/console/tools.env` (`TOOL_<ID>=on|off`; нет строки - скрипт проверяет `which`). Контракт: exit 0 - вывод инструмента; **exit 3 + `TOOL_UNAVAILABLE <id>: <подсказка>`** - не установлен/выключен → обычный порядок работы. Правила вызова - `AGENTS.md §10`.

## Graphify во вкладке "Память"

Зеркало OpenWiki: тоггл Graphify в "Рабочих папках" (`state.workspaces. graphify`) → "Собрать" (`graphify extract .` при первом запуске, далее `graphify update .`; detached-процесс, лог `graphify-out/.console-build.log`, pid в `.console-build.json`) → "Опубликовать" копирует `graphify-out/ graph.html` в `public/graphify/<sha256-slug12>/index.html` → iframe с того же origin. Счётчики узлов/рёбер - из `graph.json` (лимит разбора 8 МБ). vis-network грузится с unpkg - просмотр требует интернета, сборка локальная (tree-sitter, без LLM).

## LLM-провайдеры сборок (OpenWiki, Graphify)

OpenWiki и Graphify конфигурируются пресетами провайдеров - шестерёнка в карточке инструмента ("Настройки → Инструменты") или во вкладке OpenWiki. Пресеты: OpenAI-совместимый (Ollama/vLLM - с base URL), OpenAI, Gemini, Claude, Kimi, DeepSeek (списки - `core/llmPresets.ts`). Конфиг - `state.openwikiLlm` / `state.graphifyLlm` (ключ - локально, вне git); при сборке значения передаются CLI переменными окружения (OpenWiki: `OPENWIKI_PROVIDER`, `OPENAI_COMPATIBLE_*`, `OPENWIKI_MODEL_ID`; Graphify: env-ключ бэкенда, `--backend` auto-detect). OpenWiki полностью работает с локальной Ollama - runtime ★ для него не нужен. Модель должна существовать у провайдера (ретирнутые теги cloud-моделей отклоняются).

## Дашборды (Serena :24282, Headroom :8787)

Дашборд работает, только пока запущен сам инструмент: Serena запускает его вместе с MCP-сервером (сессия агента), Headroom - вместе с прокси. Кнопка "Дашборд" открывает модалку с проверкой доступности (TCP-проба порта с сервера - соединение без HTTP-запроса) и iframe'ом (страницу грузит браузер). Если дашборд не запущен - кнопка "Запустить автономный инстанс": detached-процесс (`serena start-mcp-server --transport streamable-http --port 9121 --enable-web-dashboard true --open-web-dashboard false` / `headroom proxy --port 8787`), pid - в `.agents/console/dashboards.json`, лог - `.agents/console/logs/<id>-dashboard.log`, остановка - кнопкой в модалке. Флаг `--enable-web-dashboard` перекрывает конфиг пользователя (`web_dashboard: false` в `~/.serena/serena_config.yml` не мешает автономному инстансу; сам конфиг консоль не правит). Запущенные сессиями агентов дашборды тоже определяются пробой порта, но консоль их не останавливает.

**Автозапуск** - Toggle в правом нижнем углу карточки Serena/Headroom (`state.tools.autostart`): включение немедленно запускает инстанс (если порт не отвечает), выключение - останавливает консольный; далее консоль поддерживает сервис запущенным при обращениях к `/api/tools` (ленивый запуск, повторные попытки не чаще раза в 30 с).

**Вывод job'ов установки** пишется на диск - `.agents/console/tool-jobs/<id>.log` + `.json` (статус), SSE-роут `/api/tools/job` читает файлы: источник инвариантен к HMR и границам route-бандлов (in-memory Map в dev пуста в соседнем бандле - это и давало вечное "ожидание вывода").

## Статистика использования

`.agents/console/tools-usage.json`: события консоли (install/uninstall/ reinstall/toggle/build/graph/index/pm; лимит 1000) + снапшоты внешних метрик не чаще раза в 5 минут - **только CLI/файлы** (`rtk gain --format json --all`, `~/.headroom/proxy_savings.json` / `headroom savings`). Серверных HTTP-запросов на локальные порты консоль не делает; дашборды Serena/Headroom открываются iframe прямо из браузера (кнопка "Дашборд").

## Безопасность

- Установочные команды - литеральные массивы из реестра `core/tools.ts`; spawn без оболочки; пути валидируются; MCP-имена - существующий `isValidMcpName`.
- Внешние инсталлеры в setup.sh скачиваются в `.agents/.tmp/setup/` и запускаются файлами (без `curl | bash`).
- Дашборды инструментов (Serena :24282, Headroom :8787) не аутентифицированы - слушают loopback. Serena встраивается iframe напрямую; Headroom ставит `x-frame-options: DENY`, поэтому его iframe грузится через embed-прокси консоли (`/dashboard/*` → `127.0.0.1:8787/dashboard/*`): апстрим - литерал из кода (не пользовательский ввод), только GET, из ответа снимаются заголовки фрейминга. Прямой URL остаётся кнопкой "открыть в новой вкладке".

## Правило поддержки

Новый внешний инструмент - той же серией коммитов: `core/tools.ts` + `tool.sh` + `setup.sh` + этот документ + таблица в `AGENTS.md §10`.
