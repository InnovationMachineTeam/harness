# Сессии: история, просмотр, ответы

Консоль показывает историю сессий рантаймов и позволяет отвечать в ожидающую сессию, продолжая её headless-запуском CLI.

## Источники по рантаймам

| Рантайм | Источник | Привязка к папке |
|---|---|---|
| claude | `~/.claude/projects/<dashed-слаг>/*.jsonl` | слаг = рабочая папка → точная фильтрация |
| codex | `~/.codex/sessions/**/rollout-*.jsonl` (+archived) | `cwd` в `session_meta` (1-я строка, ~22 КБ) → фильтрация |
| kimi | `~/.kimi-code/session_index.jsonl` (`sessionId, sessionDir, workDir`) + `state.json` (title, createdAt/updatedAt) | `workDir` → фильтрация |
| zcode | `~/.zcode/cli/rollout/model-io-sess_*.jsonl` | глобальный список; связь с репо - корреляция sess-id с `.zcode/plans/plan-sess_*.md` |
| opencode, cursor | SQLite (`opencode.db`, `state.vscdb`) | не поддерживается - в UI честно помечено |

Фильтрация - по рабочим папкам консоли (`/workspaces`, см. [operations.md](operations.md)); без папки - все папки.

## Просмотр

`GET /api/sessions?runtime=&dir=` - список (id, startedAt, lastActivityAt, workspaceDir, titleHint, sizeBytes, resumable). `&id=` - детали: метаданные + текстовое превью транскрипта (первые ~30 записей):

- claude: текстовые блоки user/assistant из jsonl-строк;
- codex: `payload.type` user_message/agent_message;
- zcode/kimi: метаданные (формат логов - сырые запросы/ответы модели).

Полные данные остаются в файле сессии; консоль читает только первые/последние чанки (head/tail хелперы).

## Ожидание ввода и ответы

Индикатор ⏳ "ждёт ввода" - эвристика ([runtimes.md](runtimes.md)): ход завершён, файл не изменяется ≥ 2 мин, процессы работают. В просмотре сессии - поле "Ответить": `POST /api/sessions/reply {runtime, sessionId, text, cwd}`.

Headless-resume команды (cwd = папка сессии, таймаут 120 с, вывод - в UI):

| Рантайм | Команда |
|---|---|
| claude | `claude -p --resume <sessionId> "<text>"` |
| codex | `codex exec resume <sessionId> "<text>"` |
| zcode | `node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs -p --resume sess_<id> "<text>"` |
| kimi | `kimi --session <sessionId> -p "<text>"` |
| opencode | `opencode run -s <sessionId> "<text>"` |
| cursor | - (нет headless CLI) |

Ответ выполняется **отдельным процессом** - интерактивная сессия пользователя не изменяется; в UI это явно подписано. Превью новых ходов появится в списке сессий после обновления.

Родственный механизм - запуск промта в **новой** сессии ([operations.md](operations.md)): команды `claude -p "<text>"`, `codex exec "<text>"`, `zcode -p`, `kimi -p`, `opencode run "<text>"`.
