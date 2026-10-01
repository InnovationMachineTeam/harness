# Agentic OS Console

Веб-консоль для управления рантаймами агентов (Claude Code, Codex CLI, ZCode, Cursor, Kimi Code, OpenCode): дашборд активности, диагностика проблем, MCP и навыки (установка/создание/удаление из skills.sh), история сессий с ответами, процессы, рабочие папки.

Стек: **Bun** (менеджер пакетов и раннер), **Next.js 15** (App Router, RSC), **React 19**, **Tailwind CSS v4**. Других рантайм-зависимостей нет.

UI собран на внутреннем UIKit (`src/ui/UIKit.tsx`): примитивы интерфейса, layout-компоненты (`Page`/`PageHeader`/`NavBar`), кастомные контролы вместо нативных (`Select`, `confirmDialog`). Справочник - [`docs/ui-kit.md`](../../docs/ui-kit.md).

## Запуск

```bash
bash tooling/scripts/setup.sh   # проверка/установка системных зависимостей
                                 # (bun, node ≥ 22, openwiki) - с подтверждением
bun install            # из корня репозитория (workspaces)
bun run console        # dev-сервер → http://localhost:3000 (порт закреплён: next dev -p 3000)
# или из apps/console:
bun run dev
```

**Правило одного инстанса.** Консоль работает на порту **3000** и только там. Если порт занят - **не запускайте второй инстанс** (Next без явного порта молча перескочил бы на 3001/3002/…, и таких "потерянных" серверов легко накопить): сначала проверьте, какой процесс занимает порт (`lsof -i :3000 -sTCP:LISTEN`) - почти наверняка это уже запущенная консоль, пользуйтесь ей. Чужой или зависший процесс сначала остановите (`kill <pid>`), потом запускайте заново.

`setup.sh` показывает статус системы и ставит недостающее (macOS - Homebrew, Linux - официальные инсталлеры; правила - `AGENTS.md §10`), спрашивает пакетный менеджер глобальных npm-пакетов (Bun/NPM) и предлагает опциональные инструменты экономии токенов (Serena, qmd, CodeGraph, Graphify, RTK, Headroom). Если bun уже установлен, то же самое - командой `bun run setup` (полезные флаги: `--check` - только статус, `--yes` - без вопросов).

- `bun run console:build` - production-сборка (останавливайте dev-сервер: build и dev конфликтуют на каталоге `.next`);
- `bun run console:test` - unit-тесты (`bun test`);
- API: `/api/runtimes`, `/api/mcp`, `/api/skills`, `/api/sessions`, `/api/sessions/reply`, `/api/processes`, `/api/processes/action`, `/api/workspaces`.

## Разделы консоли

- **Рантаймы** `/` - карточки: статус (активен сейчас / был активен / неактивен / не установлен / нет данных), последняя активность с масштабом (репозиторий или машина), модели, capabilities, права; бейджи проблем (⚠) и ожидания ввода (⏳). Клик - пространство рантайма.
- **`/runtime/<id>`** - вкладки: Обзор (расширенная статистика + MCP), Диагностика (проблемы с hint'ами и кнопкой "Исправить"), Навыки и скрипты (под-вкладки Runtime Skills / Harness Skills / Scripts / MCP), Сессии (список по рабочей папке → превью транскрипта → ответ), Процессы (таблица с cpu/mem/uptime, стоп SIGTERM→SIGKILL, рестарт для .app), Память (memory-файлы этого рантайма: рабочие папки + "Глобальные"). Звезда ★ в шапке - выбрать рантайм по умолчанию.
- **Навыки** `/skills` - установка из skills.sh (`bunx skills find/add/remove`), создание через рантайм, глобальный toggle и per-skill значения по умолчанию.
- **MCP** `/mcp` - реестр + модалка установки: пресеты (Context7, DeepWiki, WebMCP, Playwright, Serena, qmd, CodeGraph) и ручная форма; синк во все файлы рантаймов. Шестерёнка на карточке сервера - настройки транспорта (stdio: command/args/env, http: url/headers) с синком после сохранения.
- **Плагины** `/plugins` - бандлы MCP(+навыков): включённый плагин добавляет свои MCP в общий реестр (и синк), выключенный - убирает. Builtin-плагин Chrome DevTools; marketplace - JSON-манифесты по https-URL.
- **Рабочие папки** `/workspaces` - обязательная папка (минимум одна) + дополнительные (по умолчанию `docs/` и `sources/`); по ним фильтруются сессии. Тогглы **OpenWiki**/**Graphify** в строке включают папку в сборку вики и графа знаний. "Локальные проекты" - `sources/`: клонирование git-репозиториев по https-ссылке для локальной работы (в git не попадает).
- **Память** `/memory` - документы рабочих папок (Docs), вики OpenWiki, графы Graphify и memory-файлы рантаймов (Runtime); всё читается с диска. У собранной вики - кнопка **"Граф"**: встроенный визуализатор openwiki; у Graphify - публикация graph.html в iframe (просмотр требует интернета для CDN-библиотек). Детали - в [docs/operations.md](../../docs/operations.md) ("Память").
- **Настройки** `/settings` - вкладка **"Основные"**: рантаймы под задачи. Вкладка **"Design"**: темы консоли - выбор из 5 тёмных и 5 светлых пресетов (Graphite, Dracula, Nord, One Dark Pro, Tokyo Night; Graphite Light, Solarized Light, GitHub Light, Nord Light, One Light), слайдеры-твики активной темы с предпросмотром в реальном времени (несохранённые изменения сбрасываются обновлением страницы), кнопки "Сбросить"/"Сохранить" (запекает значения в `DESIGN.md` / `DESIGN.light.md` в корне репозитория - формат [@google/design.md](https://github.com/google-labs-code/design.md) - и в стилевой файл; пресеты лежат в папке `themes/` и подгружаются лениво). Предпросмотр файла следует за активной темой и при твиках пересобирается на клиенте с именем "<База> (Custom)" - диск меняется только по "Сохранить". Переключатель тёмной/светлой темы - ☀/☾ в шапке. Подробности - [docs/ui-kit.md](../../docs/ui-kit.md) ("Дизайн-токены и темы"). Вкладка **"Инструменты"**: жизненный цикл инструментов экономии токенов (Serena, qmd, CodeGraph, Graphify, RTK, Headroom, OpenWiki) - установка с выбором рантаймов и параметров, вкл/выкл, переустановка, удаление, **диагностика** (проверки + headless-исправление), дашборды с точками-индикаторами (iframe, fullscreen), автозапуск сервисов и сводка статистики; выбор менеджера npm-пакетов (Bun/NPM). Подробности - [docs/tools.md](../../docs/tools.md), разработка плагинов инструментов - [docs/tools-dev.md](../../docs/tools-dev.md).

## MCP: глобальный реестр и синк

Правило: таргет управляет своими именами - текущим реестром ∻ тем, что сам писал в прошлый синк (иначе сервер, покинувший реестр - например, при выключении плагина, - остался бы в файлах навсегда). Чужие записи в файлах не изменяются. Отключение (toggle) удаляет сервер из файлов, но сохраняет запись в реестре (вернуть - toggle обратно).

| Таргет | Формат |
|---|---|
| `<repo>/.mcp.json` | `mcpServers` (общий проектный, все рантаймы) - по глобальному toggle |
| Claude Code (user) | `claude mcp add-json/remove -s user` (CLI; fallback - мерж `~/.claude.json`) |
| Codex global | `~/.codex/config.toml`, секции `[mcp_servers.<name>]` (+`.env`) - посекционный редактор |
| Cursor global | `~/.cursor/mcp.json` (`mcpServers`) |
| OpenCode global | `~/.config/opencode/opencode.jsonc`, ключ `mcp` (`type: local/remote`) |
| ZCode / Kimi global | глобального MCP-ключа нет - работает только проектный `.mcp.json` |

Override рантайма (чипы в реестре, тогглы в space) действует на пользовательский конфиг этого рантайма: `final = override ?? глобальный enabled`. Транспорт сервера (command/args/env или url/headers) редактируется через шестерёнку на карточке - `PATCH /api/mcp { transport }`; включённость и override-чипы при этом сохраняются.

## Сессии и ответы

Источники: Claude - `~/.claude/projects/<слаг-папки>/*.jsonl`; Codex - `~/.codex/sessions/**` (cwd в `session_meta`); Kimi - `session_index.jsonl` (workDir); ZCode - `~/.zcode/cli/rollout/model-io-sess_*` (без привязки к папке, связь с репо - через plan-файлы). OpenCode/Cursor - история в SQLite, не поддерживается. Ожидание ввода: последний ход завершён (assistant / task_complete / completedAt), файл не изменяется ≥ 2 мин, процессы работают.

Ответ в сессию - headless-resume CLI: `claude -p --resume <id> "…"`, `codex exec resume <id> "…"`, `node …/zcode.cjs -p --resume sess_<id> "…"`, `kimi --session <id> -p "…"`, `opencode run -s <id> "…"` (таймаут 120 с, вывод возвращается в UI; сессия продолжается отдельным процессом).

## Рантайм по умолчанию и запуск промтов

★ на странице рантайма выбирает рантайм по умолчанию (хранится в состоянии). Кнопка "Исправить" в диагностике формирует промпт по проблеме (заголовок, детали, рекомендация + требование соблюдать AGENTS.md/guard) и запускает его в **новой headless-сессии** рантайма по умолчанию (`claude -p`, `codex exec`, `zcode -p`, `kimi -p`, `opencode run`): процесс отвязанный, вывод - в `.agents/console/runs/<ts>-<runtime>.log`, сессия автоматически появляется в общем списке сессий. Тот же механизм доступен как `POST /api/prompts/run` ({prompt} или {issue}). Безопасность: allowlist бинарников, санитайзинг аргументов, без оболочки.

## Производительность

- микрокеш дашборда (TTL 5 с + дедупликация параллельных пересчётов, инвалидация при мутациях) - повторные открытия и опрос каждые 10 с мгновенны;
- страница `/runtime/<id>` пробит только выбранный рантайм (не все шесть);
- один снапшот `ps` на цикл проба (TTL 2 с) вместо спавна на каждый рантайм; перед сигналами процессам - всегда свежий срез;
- `scanLimit` у обходов ФС - гигантские каталоги (~/.cursor/extensions) не съедают секунды.

## Навыки

Установка из skills.sh: поиск - `bunx skills find <query>` (HTTP API как фолбэк), в результатах ссылка на страницу навыка; в карточке - описание (цепочка: снапшот реестра → страница навыка → GitHub → DeepWiki; iframe как последний фолбэк) и аудит безопасности. Установка - `bunx skills add <pkg> -y` (SSE-терминал с вводом). Удаление - `bunx skills remove <name> -y` с ручной зачисткой-фолбэком (.agents/skills/<name>, skills-lock.json, симлинки агентов). Создание - форма → промпт → headless-сессия рантайма задачи.

Глобальный уровень навыков - один toggle "Использовать глобальные навыки" (страница "Навыки и MCP"): включён - все глобальные навыки в каждом рантайме включены, выключен - выключены. Override конкретного навыка или MCP-сервера - тогглом в пространстве рантайма (под-вкладки Runtime Skills / Harness Skills (.agents/skills) / Scripts / MCP). Дискавери read-only: `~/.claude/skills`, кэш плагинов ZCode, `~/.cursor/skills-cursor`, `~/.codex/skills|prompts`, агенты OpenCode + проектные плагины, `extra_skill_dirs` Kimi. Файлы рантаймов не изменяются и не удаляются.

## Состояние консоли

`.agents/console/state.json` - локальный файл вне Git (атомарная запись): реестр MCP, оверлеи навыков, рабочие папки (пути можно задавать через `~`), результаты последнего синка. Переопределяется переменной `HARNESS_CONSOLE_STATE` (тесты).

## Как читается активность

| Статус | Условие |
|---|---|
| `активен сейчас` | свежий сигнал ≤ 5 минут |
| `был активен` | сигнал в пределах выбранного окна (1 ч / 24 ч / 7 дней / всё) |
| `неактивен` | сигналы старше окна |
| `не установлен` | нет маркеров установки рантайма (disabled) |
| `нет данных` | рантайм обнаружен в конфигах, но адаптер сигналов не подключен |

Источники сигналов - только mtime файлов и первые строки rollout-логов; содержимое сессий читается лишь при открытии превью и не покидает машину.

## Архитектура

```
src/
├── core/            # ядро: registry (проб+issues+awaiting), activity, state,
│   │                # mcp/sync (реестр+таргеты), processes (ps+действия),
│   │                # issues, skills (оверлеи), sessions/ (claude|codex|kimi|zcode)
├── runtimes/        # модульные адаптеры: по одному на рантайм
├── lib/signals/     # fs-хелперы (mtime, head/tail чанки) и ps-сканер
├── lib/toml.ts      # посекционный TOML-редактор для codex-конфига
├── app/             # страницы + 8 API-роутов
└── components/      # Dashboard, RuntimeCard, RuntimeSpace, SessionPanel,
                     # ProcessTable, SkillsPanel, Nav, …
```

### Подключить новый runtime

1. Конфиг в harness: `.agents/runtime/<id>/config.json` (создаст карточку).
2. Адаптер `src/runtimes/<id>.ts`: `probeSignals`/`isInstalled`/`processPattern` (активность), `detectIssues` (диагностика), `listSkills`, `listSessions`/ `getSession`/`awaitingInput`/`replyCommand`/`runCommand` (по желанию).
3. Одна строка в `ADAPTERS` в `src/runtimes/index.ts`.
4. UI-плагин (опционально): `src/plugins/runtimes/<id>.ts` - монограмма/цвет карточки + строка в `src/plugins/runtimes/index.ts`. Без плагина рантайм получает оформление по умолчанию; список рантаймов в store приходит с сервера (`GET /api/runtimes/list`), так что UI подхватывает новое подключение сам.

`ProbeContext` даёт адаптерам `repoRoot`, `home`, `workspaces` и файловые хелперы - адаптеры не ходят в файловую систему напрямую и легко тестируются.

### Порядок мутаций и кеш

Все тогглы применяются по схеме "сначала файл, потом store": API пишет `.agents/console/state.json` (атомарно) и только после успеха отвечает клиенту; клиентский zustand-store обновляется после подтверждения сервера. Данные вкладок пространства рантайма (процессы/навыки/сессии) кешируются в store (`fetchTabData` с TTL) - переключение вкладок мгновенное, протухшие данные обновляются в фоне; серверные страницы стримятся со скелетоном (`loading.tsx`).

## Совместимость с harness

- Консоль **читает** `.agents/runtime/**`, `.mimosa/`, каталоги данных рантаймов; **пишет** только в `.agents/console/state.json`, MCP-конфиги (исключительно имена из реестра) и не изменяет файлы навыков.
- Секретные паттерны (`.env*`, `*.pem`, `id_rsa`, `secrets/`) не затрагиваются.
- Действия над процессами выполняются только после перепроверки PID по паттерну рантайма; UI запрашивает подтверждение.

## Архитектура

```
src/
├── core/            # рантайм-агностичное ядро
│   ├── types.ts     # RuntimeAdapter, RuntimeSnapshot, DTO
│   ├── registry.ts  # дискавери .agents/runtime/*/config.json + проб + DTO
│   ├── activity.ts  # чистая классификация активности (тестируется)
│   └── repo.ts      # поиск корня harness (walk-up, env HARNESS_ROOT)
├── runtimes/        # модульные адаптеры: claude/codex/zcode/cursor/kimi/opencode
│   └── index.ts     # ADAPTERS - единственная точка подключения
├── lib/signals/     # fs-mtime хелперы и ps-сканер
├── app/             # Next.js: страница (RSC) + /api/runtimes
└── components/      # Dashboard, RuntimeCard, StatusBadge, ModelTable, …
```

Модульность - два уровня:

1. **Источник правды о списке рантаймов** - `.agents/runtime/<vendor>/config.json`. Карточка (модели, capabilities, hooksSupport, vendorAdapter, права) строится из конфига; новый вендор в harness появляется на дашборде автоматически.
2. **Адаптеры актуальных сигналов** - `src/runtimes/<id>.ts`. Без адаптера карточка работает, но со статусом "нет данных"; ошибка адаптера не приводит к сбою дашборда.

### Подключить новый runtime

1. Конфиг в harness: `.agents/runtime/<id>/config.json` (создаст карточку).
2. Адаптер: `src/runtimes/<id>.ts` -

   ```ts
   import { join } from "node:path";
   import type { RuntimeAdapter } from "@/core/types";

   export const myAdapter: RuntimeAdapter = {
     id: "<id>",                       // = имя каталога конфига
     displayName: "My Runtime",
     processPattern: /my-runtime/,     // опционально: детектор процессов
     async probeSignals(ctx) {         // опционально: актуальные сигналы
       const mtime = await ctx.fs.mtimeOf(join(ctx.home, ".my-runtime", "state.db"));
       return mtime ? [{ at: mtime, scope: "machine", source: "~/.my-runtime/state.db" }] : [];
     },
   };
   ```

3. Одна строка в списке `ADAPTERS` в `src/runtimes/index.ts`.

`ProbeContext` даёт адаптерам `repoRoot`, `home` и файловые хелперы (`newestMtime`, `collectFiles`, `headJsonLine`), так что адаптеры не ходят в файловую систему напрямую и легко тестируются.

## Совместимость с harness

- Консоль **только читает** `.agents/runtime/**`, `.mimosa/`, `.zcode/plans/` и mtime-маркеры в домашнем каталоге; ничего не пишет в harness-конфиги.
- Секретные паттерны (`.env*`, `*.pem`, `id_rsa`, `secrets/`) не затрагиваются.
- Классификация и сборка DTO покрыты `bun test` (чистые функции + фикстуры).
