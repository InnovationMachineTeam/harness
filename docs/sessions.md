# Сессии: история, просмотр, ответы

Консоль показывает историю сессий рантаймов и позволяет отвечать в ожидающую сессию, продолжая её headless-запуском CLI.

## Источники по рантаймам

| Рантайм | Источник | Привязка к папке |
|---|---|---|
| claude | `~/.claude/projects/<dashed-слаг>/*.jsonl` | слаг = рабочая папка → точная фильтрация |
| codex | `~/.codex/sessions/**/rollout-*.jsonl` (+archived) | `cwd` в `session_meta` (1-я строка, ~22 КБ) → фильтрация |
| kimi | `~/.kimi-code/session_index.jsonl` (`sessionId, sessionDir, workDir`) + `state.json` (title, createdAt/updatedAt) | `workDir` → фильтрация |
| zcode | `~/.zcode/cli/rollout/model-io-sess_*.jsonl` | глобальный список; связь с репо - корреляция sess-id с `.zcode/plans/plan-sess_*.md` |
| opencode | SQLite `~/.local/share/opencode/opencode.db`, таблица `session` (`sqlite3 -readonly -json`; `core/sessions/opencode.ts`) | колонка `directory` сессии → точная фильтрация; нет БД или sqlite3 - пустой список |
| cursor | SQLite (`state.vscdb`) | не поддерживается - в UI честно помечено |

Фильтрация - по рабочим папкам консоли (`/workspaces`, см. [operations.md](operations.md)); без папки - все папки.

## Просмотр

`GET /api/sessions?runtime=&dir=` - список (id, runtime, startedAt, lastActivityAt, workspaceDir, titleHint, sizeBytes, resumable). `runtime` - один рантайм или список через запятую; без параметра - объединённый список всех рантаймов с историей сессий, отсортированный по свежести (лимит 500). `&id=` - детали: метаданные + текстовое превью транскрипта (первые ~30 записей); детали доступны только при одном рантайме в запросе:

- claude: текстовые блоки user/assistant из jsonl-строк;
- codex: `payload.type` user_message/agent_message;
- opencode: best-effort из таблицы `message` БД (JSON `data` - роль и текстовые parts; схема зависит от версии OpenCode, пустое превью - не ошибка);
- zcode/kimi: метаданные (формат логов - сырые запросы/ответы модели).

Полные данные остаются в файле сессии; консоль читает только первые/последние чанки (head/tail хелперы). Список обогащается индексом сессий (раздел ниже); параметр `refresh=1` форсирует пересбор индекса, поле `metrics` в строке списка - накопленные метрики из индекса.

## Индекс сессий (sessions.sqlite)

Список, детали и поиск работают поверх накопленного индекса `.agents/console/sessions.sqlite` (по модели agentsview): транскрипты всех рантаймов разбираются инкрементально и складываются в SQLite - история не ограничена окном live-скана. Коллектор - `core/sessionsIndex/collect.ts`, хранилище - `core/sessionsIndex/store.ts`.

- Что накапливается по сессии: заголовок, рабочая папка и папка проекта, время старта и последней активности, длительность, число сообщений и запросов пользователя (turns), модели, токены (вход/выход/кеш), оценка стоимости по каталогу цен, счётчики вызовов инструментов (агрегат и таблица `session_tools` per-session - для детализации инструмента до сессий); тексты сообщений - для поиска.
- Инкрементальность: байтовые курсоры в самой БД (таблица `sync_cursors`); повторный проход читает только новые строки, дельты токенов суммируются с существующими. Первый проход на файле больше порога (claude/codex 32 МБ, zcode 8 МБ) пропускает историю - индекс ведётся с момента установки. Codex: кумулятивный `token_count` берётся дельтой от прошлого прохода; OpenCode: курсор по `rowid` таблицы `message`.
- Запуск сбора - ленивый, TTL 5 минут, из `/api/sessions`, `/api/sessions/search`, `/api/stats` и heatmap-роута; параллельные вызовы разделяют один проход.
- Полнотекстовый поиск - FTS5 над `session_messages` (внешний содержимый индекс, поддержка триггерами); при отсутствии FTS5 в сборке SQLite и при пустом результате - LIKE-фолбэк. Настройка `settings.sessionIndex.contentSearch` в `state.json` (по умолчанию true): false - тексты сообщений в индекс не пишутся, поиск остаётся по метаданным (заголовок, папки). Поиск: `GET /api/sessions/search?q=<строка>&runtime=&dir=&limit=`, ответ - сниппеты сообщений с метаданными сессии.
- `GET /api/stats` содержит блок `sessions` за тот же период: число сессий, токены, оценка стоимости, средняя длительность, топ проектов и микс инструментов; heatmap-метрика `sessions` - сессии по дню старта.
- Ограничения по рантаймам: kimi - только метаданные (токенов в файлах нет), новые записи - по хвосту `session_index.jsonl`; zcode - usage и модель из model-io-лога, тексты сообщений не пишутся (лог - сырые запросы/ответы модели), заголовок - последний запрос пользователя; cursor - не индексируется (история в state.vscdb).

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
