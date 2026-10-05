# Рантаймы: модульная система

Рантайм - CLI/приложение агента (Claude Code, Codex CLI, ZCode, Cursor, Kimi Code, OpenCode). Консоль построена так, чтобы список и возможности рантаймов определялись конфигурацией и адаптерами, а не хардкодом в UI.

## Источник правды

`.agents/runtime/<vendor>/config.json` - harness-конфиг вендора (модели, capabilities, permissions, hooks). Консоль **читает** эти файлы при каждом пробе (`loadVendorConfigs`): каталог с валидным `config.json` = доступный рантайм. Новые вендоры появляются на дашборде автоматически.

## Серверный адаптер (`src/runtimes/<id>.ts`)

Адаптер - единственное место, знающее специфику рантайма. Интерфейс (`core/types.ts`), все методы опциональны кроме идентификации:

```ts
interface RuntimeAdapter {
  id: string;                // = имя каталога .agents/runtime/<id>
  displayName: string;
  processPattern?: RegExp;   // матчер строк ps (процессы, awaiting)

  isInstalled?(ctx): Promise<boolean>;          // маркеры установки; false → статус disabled
  probeSignals?(ctx): Promise<ActivitySignal[]>;// mtime-следы активности (repo|machine)
  detectIssues?(ctx): Promise<Issue[]>;         // диагностика (хуки, конфиги)
  awaitingInput?(ctx): Promise<AwaitingInput|null>; // "ждёт ввода пользователя"
  listSkills?(ctx, dirs?): Promise<SkillItem[]>;
  listSessions?(ctx, dirs): Promise<SessionSummary[]>;
  getSession?(ctx, id): Promise<SessionDetail|null>;
  replyCommand?(sessionId, text);   // headless-resume: ответ в существующую сессию
  runCommand?(text);                // headless-запуск новой сессии (промпты)
}
```

`ProbeContext` = `{ repoRoot, home, fs: FsSignalHelpers, workspaces }` - адаптеры не ходят в ФС напрямую, только через хелперы (тестируемость).

Все адаптеры регистрируются в `src/runtimes/index.ts` (`ADAPTERS`) - единая точка подключения.

## Сигналы активности по рантаймам

| Рантайм | repo-сигнал | machine-сигнал |
|---|---|---|
| claude | `~/.claude/projects/<dashed-слаг-папки>/*.jsonl` | `~/.claude/history.jsonl` |
| codex | rollout с `cwd === repoRoot` (peek 1-й строки) | новейший rollout |
| zcode | `.zcode/plans/plan-sess_*.md` + корреляция sess-id с rollout | `~/.zcode/cli/rollout/*.jsonl` |
| cursor | - | `state.vscdb` + свежесть `~/.cursor` |
| kimi | - | `user-history/*.jsonl`, лог CLI |
| opencode | - | `opencode.db(-wal)` |

## Статусы

`active-now` (сигнал ≤ 5 мин) → `recently-active` (в окне: 1 ч/24 ч/7 дн/всё) → `inactive`; отдельно `disabled` (нет маркеров установки) и `unknown` (нет адаптера / ошибка проба). Карточка показывает свежейший сигнал, предпочитая repo-масштаб, если он в пределах активного окна.

## Диагностика (issues)

Общие проверки (`core/issues.ts`): все модели `verified:false` → warn; ошибки последнего MCP-синка → error. Адаптерские: наличие файла адаптера хуков и ссылка на `.guardrails/src/cli.ts` с верным `AGENT_RUNTIME`, zcode `hooks.enabled`, Cursor fail-closed, зеркало Kimi `[[hooks]]`, плагин OpenCode. Полный реестр точек применения и их состояние доступны в «Настройки → Guardrails». Issues видны бейджем ⚠ на карточке и раскрываются во вкладке "Диагностика" (с кнопкой "Исправить" → [operations.md](operations.md)).

Хуки индексов (Serena, CodeGraph, Graphify) подключены во всех рантаймах с событийными хуками: Claude и ZCode - полный набор (SessionStart, UserPromptSubmit, PreToolUse; SessionEnd - только Claude), Cursor - агрегатор `pretooluse` на preToolUse, Kimi - PreToolUse через зеркало `~/.kimi-code/config.toml`; Codex и OpenCode - правила AGENTS.md без хуков. Реестр и проверки - [tools.md](tools.md).

## Ожидание ввода (awaiting-input)

Эвристика "ход завершён + файл не изменяется ≥ 2 мин + процессы работают": claude - последняя запись `assistant`; zcode - последний ход с `completedAt`; codex - `task_complete` (+вопрос из `last_agent_message`). Индикатор ⏳ на карточке; ответить можно из просмотра сессии ([sessions.md](sessions.md)).

## Навыки и нативные команды по рантаймам

`listSkills` адаптера сканирует проектные нативные каталоги обязательной рабочей папки и глобальные каталоги; одноимённый навык проекта затеняет глобальный (тот же порядок, что у нативного разрешения рантайма). Каталоги проектов содержат только симлинки на каноническое хранилище `.agents/skills` (исключение - graphify, рабочий каталог с рантайм-вариантами); политика и синк - [skills.md](skills.md).

| Рантайм | Проектный каталог навыков | Глобальный каталог | Нативные команды (синк консоли) |
|---|---|---|---|
| claude | `.claude/skills` | `~/.claude/skills` | `.claude/commands/` - `/master:<id>`, `/workflow:<id>`, `/master`, `/workflow` |
| zcode | `.zcode/skills` + кэш плагинов `~/.zcode/cli/plugins/cache` | тот же кэш | `.zcode/commands/` - как у claude |
| codex | `.codex/skills` | `~/.codex/skills` | `.codex/skills/` навыками - `/master-<id>`, `/workflow-<id>`, `/master`, `/workflow` |
| cursor | `.cursor/skills` | `~/.cursor/skills`, `~/.cursor/skills-cursor` | `.cursor/commands/` - `/master-<id>`, `/workflow-<id>`, `/master`, `/workflow` |
| kimi | `.kimi-code/skills`, `.agents/skills` | `~/.kimi-code/skills`, `~/.agents/skills` | `.kimi-code/skills/` навыками - `/skill:master-<id>`, `/skill:workflow-<id>`, `/skill:master`, `/skill:workflow` |
| opencode | `.opencode/skills` | `~/.config/opencode` | `.opencode/command/` - `/master-<id>`, `/workflow-<id>`, `/master`, `/workflow` |

Тела команд, триггеры синка и управление - [skills.md](skills.md), раздел "Нативные команды рантаймов"; статус и ручная регенерация - Настройки → Навыки → "Команды рантаймов".

## Design-возможности

Design-инструменты распределены по уровням; правки конфигов рантаймов не требуются.

- **Дизайн-слой консоли** - раздел "Дизайн" ([design.md](design.md)): design pack обязательной директории (DESIGN.md, BRAND.md, design/ui-kit.md, design/components.json), редакторы токенов и бренда, синхронизация managed-блоком в CLAUDE.md/AGENTS.md и единый запуск дизайн-задач (headless-рантайм, провайдер, отдельная сессия) с провайдерами Claude Design, Open Design, Figma MCP.
- **Claude Code - встроенная команда `/design`** (research preview): артборды Claude Design в CLI и desktop-приложении Claude Code. Требования: версия Claude Code ≥ 2.1.234, план Pro/Max/Team/Enterprise; установка не нужна. Цикл: `/design <бриф>` → канва артбордов → выбор варианта → реализация тем же рантаймом.
- **Все рантаймы - навык `frontend-design`** (anthropics/skills): стоит в `.agents/skills/frontend-design`, симлинки - в `.claude/skills/` и `.zcode/skills/`; даёт рантайму руководство по визуальному дизайну при построении UI.
- **Design-to-code - MCP Figma** (пресет `figma` в каталоге MCP консоли): удалённый HTTP MCP `https://mcp.figma.com/mcp`; OAuth при первом вызове (в Claude Code - `/mcp` → authenticate). Читает макеты и переменные для генерации кода, поддерживает запись на канву.
- **Open Design** (nexu-io/open-design) - MCP-сервер подключается через проектный preset `od mcp --daemon-url http://127.0.0.1:7456`. Console проверяет capabilities через `od mcp --help` и не вызывает legacy `od mcp install` без подтверждённой поддержки. Инструмент оформлен плагином `core/tools/open-design.ts` - [tools.md](tools.md).

## Клиентские UI-плагины (`src/plugins/runtimes/`)

Метаданные оформления: `{ id, monogram, monogramClass }`, регистрация через `registerRuntimePlugin` в `index.ts`. Без плагина рантайм получает монограмму по умолчанию; список рантаймов в стор приходит с сервера (`GET /api/runtimes/list`) - UI подхватывает новое подключение сам.

## Guard-хуки по рантаймам

Источник точек подключения - реестр `.guardrails/src/runtimeAdapters.ts`: записи интеграций аудита и вкладки «Настройки → Guardrails» выводятся из него автоматически. Команды `bun .guardrails/src/adapters.ts check` (сверка файлов и маркеров) и `render <id>` (готовые фрагменты для конфигурации) обслуживают реестр.

Добавление нового рантайма:

1. Добавьте запись в `RUNTIME_ADAPTERS` с поддерживаемыми событиями (PreToolUse, UserPromptSubmit, PostToolUse или плагинные события) и командами хуков.
2. Перенесите фрагменты `bun .guardrails/src/adapters.ts render <id>` в конфигурацию рантайма.
3. Для LLM-пути подключите guard к моделям: обёртка `withLlmGuard` из `@harness/guardrails` (эталон - `chatModelForProvider` в консоли) или узел `langGraphGuardNode` перед модельными узлами LangGraph; обёртка рантаймо-независима и сохраняет интерфейс модели, включая bindTools и стриминг.
4. Выполните `bun .guardrails/src/cli.ts generate` - записи появятся в аудите и UI без других правок.


Политика Guardrails подключается в три точки вызова LLM: проверка вызова инструмента до исполнения (PreToolUse, `.guardrails/src/cli.ts evaluate`), скан промпта (UserPromptSubmit, `.guardrails/src/cli.ts prompt`) и скан вывода инструмента до передачи в модель (PostToolUse, `.guardrails/src/posttooluse.ts`). Контракт входной точки PostToolUse: stdin `{tool_name, tool_input, tool_response}`, exit 0 - пропуск (предупреждения о секретах и ПДн в stderr), exit 2 - инъекция в выводе с указанием модели обработать вывод как данные. Вывод инструментов, обращённых к самодиагностирующим артефактам Guardrails (`.guardrails/rules`, `.guardrails/generated`, `.guardrails/tests`, `.guardrails/src/content`), не сканируется.

| Рантайм | PreToolUse | UserPromptSubmit | PostToolUse |
|---|---|---|---|
| Claude Code | нативный хук, fail-closed | подключён, fail-open | подключён |
| ZCode | нативный хук, fail-closed | подключён, fail-open | подключён |
| Cursor | fail-closed агрегатор | событие не поддерживается | событие не поддерживается |
| Codex | после доверия каталогу `.codex/` | правила AGENTS.md вместо хука | событие не поддерживается |
| Kimi Code | через зеркало `~/.kimi-code/config.toml` - синхронизировано с текущим движком | блоки в шаблоне закомментированы до проверки поддержки событий | блоки в шаблоне закомментированы до проверки поддержки событий |
| OpenCode | плагин `tool.execute.before` | не подключено | возможно через `tool.execute.after`, требует проверки SDK |

Консоль (direct-чат, workflow и MCP-агенты) защищается обёрткой моделей `chatModelForProvider`: инъекции блокируются, персональные данные и секреты редактируются в промпте и ответе, включая выводы инструментов, возвращаемые в messages. Состояние точек применения - «Настройки → Guardrails» и `bun .guardrails/src/cli.ts where <id>`.

## Подключить новый рантайм

1. Конфиг harness: `.agents/runtime/<id>/config.json` (карточка появится и без адаптера - со статусом unknown).
2. Адаптер `src/runtimes/<id>.ts`: начать с `probeSignals`/`isInstalled`/ `processPattern`; остальное - по мере надобности (см. интерфейс выше).
3. Одна строка в `ADAPTERS` (`src/runtimes/index.ts`).
4. (опционально) UI-плагин с монограммой - файл + строка в `src/plugins/runtimes/index.ts`.
5. Обновить таблицы в [sessions.md](sessions.md), этот документ и при смене форматов - [architecture.md](architecture.md) (правила: AGENTS.md §11).
