# Плагины и marketplace

Плагин - бандл, который при включении добавляет в консоль набор MCP-серверов (и декларирует связанные навыки). Страница "Плагины": список установленных с тогглами и удалением + каталоги marketplace.

## Модель

```ts
interface PluginDef {
  id: string;                 // slug
  displayName: string;
  description?: string;
  mcp: { name: string; transport: McpTransport }[];  // вклад в реестр MCP
  skills?: { name: string; description?: string }[]; // справочно
  source: string;             // "builtin" | "marketplace:<host>"
  url?: string;
}
```

- **Включённый** плагин: его MCP-серверы physically добавляются в общий реестр (`state.mcp.servers`) и проходят обычный синк ([mcp.md](mcp.md)) - то есть видны в общем списке MCP, засинканы во все таргеты, участвуют в overrides.
- **Выключенный**: серверы убираются из реестра, если их транспорт не менялся пользователем (сравнение транспорта - защита от удаления чужих правок).
- **Удаление** = выключение + удаление записи о плагине.

Хранение: `state.plugins.installed` (PluginDef + enabled) и `state.plugins.marketplaces`.

## Builtin-плагин: Chrome DevTools

Единственный предустановленный плагин - `chrome-devtools` ([github.com/ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)): MCP `chrome-devtools` = `npx -y chrome-devtools-mcp@latest`. Находится в builtin-каталоге (`BUILTIN_PLUGINS` в `core/plugins.ts`), устанавливается с вкладки "Плагины" одним кликом.

## Marketplace

Каталог - JSON-манифест по http(s)-URL. Формат:

```json
{
  "plugins": [
    {
      "id": "my-plugin",
      "displayName": "My Plugin",
      "description": "Что добавляет",
      "url": "https://github.com/org/repo",
      "mcp": [
        { "name": "my-server", "transport": { "type": "stdio", "command": "npx", "args": ["-y", "my-server"] } },
        { "name": "my-remote", "transport": { "type": "http", "url": "https://example.com/mcp" } }
      ],
      "skills": [{ "name": "my-skill", "description": "…" }]
    }
  ]
}
```

Валидация на сервере (`fetchMarketplacePlugins` + `normalizePlugin`): id/name - строгие slugs; транспорты - только stdio{command,args?,env?} или http{url}; описание обрезается. Установка из каталога ищет плагин **по id в доверенных каталогах** (builtin + добавленные marketplace), а не в теле запроса - произвольные определения с клиента не принимаются.

SSRF-защита: только http/https; запрет localhost/`.local`/127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16; таймаут 10 с; лимит 512 КБ.

## API

| Роут | Действие |
|---|---|
| `GET /api/plugins` | installed + каталоги (builtin + marketplaces, с ошибками загрузки) |
| `POST /api/plugins {plugin:{id}}` | установить из каталога (enabled=true + синк) |
| `PATCH /api/plugins {id, enabled}` | вкл/выкл (+синк) |
| `DELETE /api/plugins?id=` | удалить |
| `POST /api/plugins/marketplace {name, url}` | добавить каталог (валидация имени/URL, без дублей) |
| `DELETE /api/plugins/marketplace?name=` | убрать каталог |
