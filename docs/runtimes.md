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

Общие проверки (`core/issues.ts`): все модели `verified:false` → warn; ошибки последнего MCP-синка → error. Адаптерские: наличие файла адаптера хуков и ссылка на `guard.mjs` с верным `AGENT_RUNTIME`, zcode `hooks.enabled`, cursor fail-open, зеркало Kimi `[[hooks]]`, плагин OpenCode. Issues видны бейджем ⚠ на карточке и раскрываются во вкладке "Диагностика" (с кнопкой "Исправить" → [operations.md](operations.md)).

## Ожидание ввода (awaiting-input)

Эвристика "ход завершён + файл не изменяется ≥ 2 мин + процессы работают": claude - последняя запись `assistant`; zcode - последний ход с `completedAt`; codex - `task_complete` (+вопрос из `last_agent_message`). Индикатор ⏳ на карточке; ответить можно из просмотра сессии ([sessions.md](sessions.md)).

## Клиентские UI-плагины (`src/plugins/runtimes/`)

Метаданные оформления: `{ id, monogram, monogramClass }`, регистрация через `registerRuntimePlugin` в `index.ts`. Без плагина рантайм получает монограмму по умолчанию; список рантаймов в стор приходит с сервера (`GET /api/runtimes/list`) - UI подхватывает новое подключение сам.

## Подключить новый рантайм

1. Конфиг harness: `.agents/runtime/<id>/config.json` (карточка появится и без адаптера - со статусом unknown).
2. Адаптер `src/runtimes/<id>.ts`: начать с `probeSignals`/`isInstalled`/ `processPattern`; остальное - по мере надобности (см. интерфейс выше).
3. Одна строка в `ADAPTERS` (`src/runtimes/index.ts`).
4. (опционально) UI-плагин с монограммой - файл + строка в `src/plugins/runtimes/index.ts`.
5. Обновить таблицы в [sessions.md](sessions.md), этот документ и при смене форматов - [architecture.md](architecture.md) (правила: AGENTS.md §11).
