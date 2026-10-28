# MCP: глобальный реестр и синк в форматы рантаймов

Консоль держит собственный реестр MCP-серверов (локальный файл `.agents/console/state.json`, вне Git) и после каждого изменения прогоняет синк - запись серверов в локальные конфигурационные файлы рантаймов **в их нативных форматах**.

## Семантика включённости

```
final(runtimes R, сервер S) = S.runtimeOverrides[R] ?? S.enabled
```

- `S.enabled` - глобальный toggle (начальная настройка); управляет проектными файлами (`.mcp.json`, `.agents/mcp.json`) и всеми пользовательскими конфигами по умолчанию.
- `runtimeOverrides[R]` - override уровня рантайма (действует только на его пользовательский конфиг; выставляется в пространстве рантайма, вкладка MCP).
- Отключение (toggle) удаляет сервер из файлов, но сохраняет запись в реестре - вернуть можно одним кликом.

## Лейблы происхождения

Каждому серверу реестра выставляется лейбл происхождения (`core/mcpLabels.ts`, атрибуция по имени - реестр origin не хранит): `builtin` - собственный MCP-сервер harness (имена `harness` и `harness-http`), `tool` - сервер инструмента (mcpPreset из ToolDef, имя = id), `plugin` - вклад включённого плагина, `preset` - имя из каталога пресетов, `manual` - добавлен формой. `GET /api/mcp` отдаёт `label` у каждого сервера; вкладка MCP (настройки и пространство рантайма) фильтруется сегментированными кнопками по лейблам.

## Хуки жизненного цикла

Сервер может объявить хуки - `hooks: {install?, remove?, enable?, disable?}` (списки shell-команд) в записи реестра (`state.mcp.servers[name].hooks`, заполняется при создании через `POST /api/mcp` и правится через PATCH). Команды исполняет консоль (`core/lifecycleHooks.ts`): guard-проверка репозитория (exit 2 - отказ), `bash -c` с cwd = обязательная рабочая папка (write mode), таймаут 60 с, лог `.agents/console/hooks/mcp.log`. Установка - hook install после добавления, включение/выключение (глобальный toggle) - hook enable/disable, удаление - hook remove до удаления записи. Ошибки хуков возвращаются в ответе (`hookErrors`).

## Настройки сервера (транспорт)

Транспорт существующей записи редактируется в консоли: шестерёнка на карточке сервера (`McpPanel`) открывает `McpSettingsModal` - тип транспорта (stdio/http) и его поля:

- stdio - `command`, `args` (через пробел), `env` (построчно `KEY=value`);
- http - `url`, `headers` (построчно `KEY=value`).

Сохранение - `PATCH /api/mcp { name, transport }`: транспорт заменяется целиком, `enabled` и `runtimeOverrides` не изменяются, затем прогоняется синк. Глобальный toggle и override-чипы остаются на карточке сервера. Поле `headers` http-транспорта заполняется и при добавлении кастомного сервера ("Установить MCP" → "свой сервер"). В файлах headers поддерживают JSON-таргеты (`.mcp.json`, Cursor, фолбэк Claude); opencode (`type: "remote"`) и Codex TOML пишут только `url`.

## Таргеты синка

| Таргет | Файл / способ | Формат |
|---|---|---|
| `project` (claude, kimi) | `<repo>/.mcp.json` | `{"mcpServers": {name: {type:"stdio"\|"http", command, args, env \| url}}}` |
| `claude-user` | CLI `claude mcp add-json/remove -s user` (фолбэк - мерж `~/.claude.json`) | как project |
| `codex-global` | `~/.codex/config.toml` (посекочный редактор `lib/toml.ts`) | `[mcp_servers.<name>]` + `[.env]`; http → `url = "…"` |
| `cursor-global` | `~/.cursor/mcp.json` | как project |
| `opencode-global` | `~/.config/opencode/opencode.jsonc` | ключ `"mcp"`, `type:"local"\|"remote"` |
| `zcode-project` | `<repo>/.agents/mcp.json` | как project; действует, только если в `.zcode/config.json` нет секции `mcp.servers` |
| `kimi-global` | `~/.kimi-code/mcp.json` (или `$KIMI_CODE_HOME`) | `{"mcpServers": {name: {command, args, env \| url, headers}}}` - без `type`, транспорт выводится из command/url |
| `antigravity-project` | `<repo>/.agents/mcp_config.json` | `{"mcpServers": {name: {command, args, env \| serverUrl, headers}}}` - без `type`; remote - только streamable HTTP (`serverUrl`), SSE не поддерживается |

Рантайм → таргеты: claude - project + claude-user; codex - codex-global; cursor - cursor-global; kimi - project + kimi-global; zcode - zcode-project; opencode - opencode-global; antigravity - antigravity-project. Корневой `.mcp.json` читают только Claude Code и Kimi Code.

Примеры записей одного сервера `serena` (stdio):

```json
{ "mcpServers": { "serena": { "type": "stdio", "command": "uvx", "args": ["serena"] } } }
```

```toml
[mcp_servers.serena]
command = "uvx"
args = ["serena"]
```

## Managed-имена: что и почему чистится

Каждый таргет владеет множеством **managed-имён** = текущий реестр ∻ имена, которые таргет писал в прошлый синк (`state.lastMcpSync[target].applied`). Желаемые имена пишутся/обновляются, остальные из managed-множества - удаляются. Следствия:

- **чужие записи не затрагиваются** (пользовательский `tolaria`, другие серверы codex остаются нетронутыми);
- сервер, покинувший реестр (например, при выключении плагина), корректно удаляется из всех файлов - без "managed ∻ прошлый синк" он остался бы там навсегда (этот баг был пойман реальным round-trip'ом плагинов).

## Поток изменения

```
UI/API (POST/PATCH/DELETE /api/mcp, /api/plugins)
  → мутация реестра в state
  → syncMcp(): по таргетам: apply(managedNames) → результат {ok, applied, removed, error}
  → state.lastMcpSync = результаты; saveState() (файл - первым)
  → invalidateDashboardCache() → ответ клиенту (UI показывает статусы по таргетам)
```

Пресеты (Context7, DeepWiki, WebMCP, Playwright) - каталог `MCP_PRESETS` (`core/plugins.ts`), отдаётся `GET /api/mcp/catalog` (первой строкой - собственный сервер harness, см. ниже) и ставится одним кликом из модалки "Установить MCP" на странице MCP.

Плагины добавляют свои MCP в реестр при включении и убирают при выключении - детали и отличие от обычных серверов в [plugins.md](plugins.md).

## MCP в workflow

Узел workflow может ссылаться только на сервер, который есть в реестре и эффективно включён хотя бы для одного runtime-кандидата. Preflight проверяет это до создания run. Сохранённый snapshot фиксирует выбор runtime; event ledger записывает MCP ID, длительность и ошибку вызова, если runtime отдаёт такие события.

## MCP-клиент консоли

Помимо синка конфигов внешним рантаймам, консоль подключает серверы реестра сама (`core/mcp/client.ts`): их инструменты получает агентный цикл - шаги workflow с провайдер-кандидатом (`provider:<id>`) и диалог Ассистента (`/api/agent/chat`). stdio-сервер запускается из записи реестра (command/args/env, cwd - рабочая папка вызова), http-сервер - по URL с заголовками (Streamable HTTP). Соединения переиспользуются в процессе консоли или воркера; простой более 5 минут останавливает сервер, таймауты запуска и вызова - 30 и 60 с.

Инструменты серверов неймспейсятся `mcp__<server>__<tool>` и передаются модели вместе со встроенными инструментами цикла (`read_file`, `list_dir`, `run_command`; детали в [workflows.md](workflows.md)). У шага подключаются серверы из `mcp` ролей (эффективно включённые в реестре), у Ассистента - все включённые. Недоступный при старте сервер не ломает вызов: его инструменты опускаются, шаг пишет событие `step.mcp-unavailable`.

Design router использует упорядоченный список провайдеров из Settings. Для Claude порядок по умолчанию: Claude Design, Open Design, Figma. Для остальных runtime: Open Design, Figma. Open Design считается готовым только после проверки `od mcp --help`; daemon mode использует `od mcp --daemon-url`, а legacy install доступен лишь когда CLI действительно публикует `od mcp install <agent>`. Figma проходит обычную проверку enabled и OAuth readiness реестра MCP. Настройку применяет дизайн-слой консоли ([design.md](design.md)): порядок определяет дизайн-MCP дизайн-задачи и учитывается дизайн-раннером.

## Собственный MCP-сервер harness

Помимо реестра сторонних серверов, консоль содержит **собственный MCP-сервер** `harness`: возможности платформы (запуск промтов и workflow, рутины, каталог рабочих папок, сессии, мониторинг, знания) выставлены как MCP-инструменты. Код - `apps/console/src/mcp-server/`; SDK `@modelcontextprotocol/sdk` уже входит в зависимости консоли. Один сборщик инструментария, два транспорта:

- **stdio** - вход `mcp-server/index.ts` (`McpServer` + `StdioServerTransport`); рантаймы спавнят процесс `bun <repoRoot>/apps/console/src/mcp-server/index.ts` записью `harness` реестра, env `HARNESS_ROOT` якорит корень при запуске из любого cwd. Клиент консоли подключает его наряду со сторонними серверами (инструменты `mcp__harness__<tool>`).
- **HTTP (streamable)** - роут `POST|GET|DELETE /api/mcp/harness` (`WebStandardStreamableHTTPServerTransport`, ответы JSON, сессии по заголовку `mcp-session-id`); авторизация - Bearer-токен `state.mcpHttp` (выключен - 403, неверный токен - 401), по образцу AG-UI endpoint. Каждая сессия получает свой экземпляр сервера; карта сессий живёт в процессе консоли - рестарт консоли разрывает сессии, клиент переподключается. Запись реестра `harness-http` (url + Bearer-заголовок) регистрируется той же панелью.

Сервер использует core-модули консоли in-process, без HTTP-вызовов к самой консоли: мутации и сложные операции идут через route handlers in-process (`mcp-server/actions.ts`), чтения каталогов и события прогона - напрямую в core. Прецедент headless-запуска core - workflow-worker.

### Конфигурация

Файл `.agents/console/mcp-server.json` (вне Git):

```json
{
  "workspaces": "all",
  "groups": { "prompts": true, "workflows": true, "routines": true, "catalog": true, "sessions": true, "monitoring": false, "knowledge": true },
  "monitoring": { "stopProcesses": false },
  "workflowTools": { "enabled": true, "workflows": "all" }
}
```

- `workspaces` - "all" (все рабочие папки из state) или список абсолютных путей; каждый параметр `workspace` инструмента валидируется по этому множеству (workspace containment через `resolveWorkflowWorkspace`).
- `groups` - включённые группы инструментов (см. таблицу ниже); `monitoring.stopProcesses` отдельно открывает деструктивный `stop_process`.
- `workflowTools` - динамические инструменты: каждый workflow экспонированных папок становится отдельным инструментом `workflow_<id>` (описание - из YAML), вызов равен `start_workflow` для этой папки; потолок 30, `workflows` - allowlist по id; коллизия id между папками разрешается суффиксом `__<имя папки>`.
- env-переопределения `HARNESS_MCP_GROUPS` (список включённых групп) и `HARNESS_MCP_WORKSPACES` ("all" или пути через запятую) задают per-runtime профиль через env транспорта записи реестра (например, read-only набор для внешнего бота).
- Конфиг перечитывается фоновым пересбором (тик 15 с); изменения применяются на живом соединении (register/enable/disable + уведомление `toolListChanged`).

Панель "Собственный сервер harness" (Настройки - MCP) читает/пишет конфиг через `GET|PUT /api/mcp-server` и выполняет регистрацию: stdio-запись `harness` (вкл/выкл), HTTP-транспорт (тумблер + генерация токена, запись `harness-http` обновляется при ротации токена). После мутаций выполняется managed-синк реестра.

### Группы инструментов

| Группа | Инструменты |
|---|---|
| prompts | `run_prompt` {prompt, runtime?, workspace?} - headless-сессия рантайма или `provider:<id>`; возвращает лог-файл и PID |
| workflows | `list_workflows`, `read_workflow`, `start_workflow` (preflight + snapshot, будит воркер), `workflow_status`, `workflow_events`, `workflow_action` (approve/retry/cancel/...) |
| routines | `list_routines`, `create_routine`, `update_routine`, `delete_routine`, `run_routine_now` (заявка исполняет воркер) |
| catalog | `list_workspaces`, `list_roles`, `list_skills`, `slash_menu` |
| sessions | `list_sessions`, `search_sessions` (FTS5 индекса), `reply_session` (headless-resume, до 120 с) |
| monitoring | `list_tasks`, `list_processes`, `stop_process` (только при `monitoring.stopProcesses`) |
| knowledge | `list_lessons`, `roadmap`, `list_sprints`, `stats`, `read_file` (allowlist корней памяти) |

Результат инструмента - JSON-текст с отсечением по объёму (48 000 символов); ошибка действия - `isError` с текстом. Запускающие инструменты возвращаются сразу (процессы detached); исключение - `reply_session`, ожидающая завершения ответа.
