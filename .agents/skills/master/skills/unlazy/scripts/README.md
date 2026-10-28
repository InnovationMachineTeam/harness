# Скрипты unlazy

Перенос скриптов навыка unlazy (github.com/Leonxlnx/unlazy, MIT, v2.1.0, коммит донора 16671491f6679ad9378f52604d3bc2415b4120c7). Лицензия донора - `LICENSE` рядом. Zero npm-зависимостей, Node 16+.

Содержимое: `gate-check.mjs` (статус, исполнение, одобрение и реверификация гейтов; claim/release leases; журнал скоупа), `gate-lint.mjs` (статический линтер реестров), `dispatch-check.mjs` (волны диспетчеризации агентов), `stop-hook.mjs` (Stop-хук рантайма), `install-hooks.mjs` (автономный установщик хука), `lib/` (общие библиотеки).

## Отличия от донора

1. `lib/gates.mjs`: константа `UNLAZY_DIR` - `.agents/.tmp/unlazy` вместо `.unlazy` (состояние скоупов во временной зоне репозитория, разрешённой guard'у для очистки); fallback файл хук-состояния корня - `.agents/.tmp/unlazy-hook-state.json`. Хранилище одобрений `~/.unlazy/approved` сохранено донорским (вне репозитория, права 0700; переопределяется `UNLAZY_APPROVAL_DIR`).
2. `gate-check.mjs`, `install-hooks.mjs`: тексты справки и заметок приведены к новым путям.
3. `stop-hook.mjs`: добавлен флаг `--adapter zcode` - блокировка по контракту ZCode (exit 2, причина в stderr) вместо контракта Claude Code (JSON `{"decision":"block"}`, exit 0); fallback cwd и session id берёт из переменных `ZCODE_PROJECT_DIR`/`CLAUDE_PROJECT_DIR`/`CLAUDE_SESSION_ID`.
4. `tests/*.mjs`: строковые пути `.unlazy` mechanically заменены на `.agents/.tmp/unlazy`; суффикс бэкапа `.unlazy.bak` сохранён донорским; в тесте hardlink хук-состояния добавлен mkdir родительского каталога; фразовые проверки self-check локализованы под русский SKILL.md и references (структурные проверки PLAN, скриптов и импортов сохранены).
5. `install-hooks.mjs` в harness не используется: Stop-хук подключается вручную в `.claude/settings.json` и `.zcode/config.json` (событие `Stop`); установщик оставлен для автономного использования навыка вне репозитория.

## Запуск тестов

```bash
node tests/run-tests.mjs
node tests/dispatch-tests.mjs
node tests/hardening-tests.mjs
node tests/stress-tests.mjs
node tests/lint-tests.mjs
node tests/contract-tests.mjs
node tests/self-check.mjs
```

## Cursor-зеркало

Синк навыков Cursor переносит все файлы навыка рекурсивно (hardlink-зеркало, `core/skillLinks.ts`); скрипты, references и templates доступны в зеркале так же, как в каноне. Команды в SKILL.md используют `<skill-dir>` - каталог, содержащий SKILL.md, и резолвятся по месту чтения.
