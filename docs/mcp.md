# MCP: глобальный реестр и синк в форматы рантаймов

Консоль держит собственный реестр MCP-серверов (локальный файл `.agents/console/state.json`, вне Git) и после каждого изменения прогоняет синк - запись серверов в локальные конфигурационные файлы рантаймов **в их нативных форматах**.

## Семантика включённости

```
final(runtimes R, сервер S) = S.runtimeOverrides[R] ?? S.enabled
```

- `S.enabled` - глобальный toggle (начальная настройка); управляет проектным `.mcp.json` и всеми пользовательскими конфигами по умолчанию.
- `runtimeOverrides[R]` - override уровня рантайма (действует только на его пользовательский конфиг; выставляется в пространстве рантайма, вкладка MCP).
- Отключение (toggle) удаляет сервер из файлов, но сохраняет запись в реестре - вернуть можно одним кликом.

## Настройки сервера (транспорт)

Транспорт существующей записи редактируется в консоли: шестерёнка на карточке сервера (`McpPanel`) открывает `McpSettingsModal` - тип транспорта (stdio/http) и его поля:

- stdio - `command`, `args` (через пробел), `env` (построчно `KEY=value`);
- http - `url`, `headers` (построчно `KEY=value`).

Сохранение - `PATCH /api/mcp { name, transport }`: транспорт заменяется целиком, `enabled` и `runtimeOverrides` не изменяются, затем прогоняется синк. Глобальный toggle и override-чипы остаются на карточке сервера. Поле `headers` http-транспорта заполняется и при добавлении кастомного сервера ("Установить MCP" → "свой сервер"). В файлах headers поддерживают JSON-таргеты (`.mcp.json`, Cursor, фолбэк Claude); opencode (`type: "remote"`) и Codex TOML пишут только `url`.

## Таргеты синка

| Таргет | Файл / способ | Формат |
|---|---|---|
| `project` | `<repo>/.mcp.json` | `{"mcpServers": {name: {type:"stdio"\|"http", command, args, env \| url}}}` |
| `claude-user` | CLI `claude mcp add-json/remove -s user` (фолбэк - мерж `~/.claude.json`) | как project |
| `codex-global` | `~/.codex/config.toml` (посекочный редактор `lib/toml.ts`) | `[mcp_servers.<name>]` + `[.env]`; http → `url = "…"` |
| `cursor-global` | `~/.cursor/mcp.json` | как project |
| `opencode-global` | `~/.config/opencode/opencode.jsonc` | ключ `"mcp"`, `type:"local"\|"remote"` |
| zcode / kimi | глобального MCP-ключа нет | только проектный `.mcp.json` |

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

Пресеты (Context7, DeepWiki, WebMCP, Playwright) - каталог `MCP_PRESETS` (`core/plugins.ts`), отдаётся `GET /api/mcp/catalog` и ставится одним кликом из модалки "Установить MCP" на странице MCP.

Плагины добавляют свои MCP в реестр при включении и убирают при выключении - детали и отличие от обычных серверов в [plugins.md](plugins.md).
