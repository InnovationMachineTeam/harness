---
type: "Справочник по политике рантаймов"
title: "Рантаймы агентов, Guard и верификация"
description: "Шесть поддерживаемых рантаймов агентов, их конфиги в .agents/runtime/, единый движок политики guard.mjs (PreToolUse, exit 0/2), профили и лимиты, модели tier→модель и команды верификации."
tags: [agent-runtime, guard, policy, verification, configuration, hooks]
openwiki_generated: true
sources:
  - id: openwiki-source-a6c963ad53c782c6ce6f027a
    resource: repo://.agents/runtime/claude/config.json
  - id: openwiki-source-5e76b010cbb011782d1eee5c
    resource: repo://.agents/runtime/config.json
  - id: openwiki-source-21dab132475642cc4400b339
    resource: repo://.agents/runtime/guard.mjs
  - id: openwiki-source-828db7499758ca55e5b59ed9
    resource: repo://.agents/runtime/opencode/config.json
  - id: openwiki-source-077b44aa74d95fe85507afc3
    resource: repo://.opencode/plugins/agentos-guard.ts
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-46d460b296699fb9f8cef632
    resource: repo://tooling/scripts/src/verify.ts
generated: { by: "openwiki/0.6.1", at: "2026-10-01T21:02:38.012Z" }
---

# Рантаймы агентов, Guard и верификация

Репозиторий поддерживает шесть рантаймов агентов (Claude Code, Codex CLI, ZCode, Cursor, Kimi Code, OpenCode) под одной общей политикой. Общие настройки лежат в `.agents/runtime/config.json`; у каждого рантайма - свой `.agents/runtime/<vendor>/config.json`. Единый движок политики `.agents/runtime/guard.mjs` проверяет вызовы инструментов до их выполнения. `AGENTS.md` - канонический файл инструкций (`canonicalInstructions`), обязательный для каждого рантайма; он связывает переменные из `.agents/runtime/` с контекстами применения.

## Слои конфигурации

| Файл | Содержимое |
|---|---|
| `.agents/runtime/config.json` | Общее: `canonicalInstructions`, `defaultVendor`, путь к `guard`, команды `verification`, каталог `temp`, `limits`, `profiles` |
| `.agents/runtime/<vendor>/config.json` | По рантайму: файл адаптера (`vendorAdapter`), команда `guard` и `hooksSupport`, `capabilities`, `models` по tier, `permissions` |

Консоль читает конфиги вендоров при каждом пробе (`loadVendorConfigs`): каталог с валидным `config.json` - доступный рантайм, новый вендор появляется на дашборде без изменений кода. Сама консоль описана в [Обзоре архитектуры](overview.md).

## Идентификация рантайма

В начале сессии агент определяет свой рантайм и выставляет `AGENT_RUNTIME` и `AGENT_RUNTIME_CONFIG` - обе переменные используются guard'ом и шагом верификации. Таблица в `AGENTS.md` §1 сопоставляет каждый рантайм его адаптеру хуков:

| Рантайм | Адаптер | Хуки |
|---|---|---|
| claude | `.claude/settings.json` (PreToolUse) | native |
| codex | `.codex/hooks.json` (PreToolUse; загрузка после trust через `/hooks`) | native |
| zcode | `.zcode/config.json` (`hooks.events.PreToolUse`) | native |
| cursor | `.cursor/hooks.json` (`preToolUse`, fail-open) | native |
| kimi | `.kimi/config.toml` → зеркало в `~/.kimi-code/config.toml` | user-mirror |
| opencode | `opencode.json` + плагин `.opencode/plugins/agentos-guard.ts` | native (плагин) |

Особенности механизмов доставки:

- Cursor работает с `failClosed: false` - упавший хук пропускает вызов; guard здесь - слой поверх одобрений IDE.
- У Kimi проектных хуков нет: пользователь копирует `[[hooks]]`-блок из `.kimi/config.toml` в `~/.kimi-code/config.toml`; хуки Kimi запускаются с cwd = каталог проекта, поэтому относительный путь к guard работает. До зеркала политика соблюдается поведенчески.
- OpenCode не имеет декларативных хуков: плагин `agentos-guard.ts` подписывается на `tool.execute.before`, прогоняет payload через guard и при exit 2 бросает ошибку, которая отклоняет вызов.

## Временный вывод настроек (TEMP)

`AGENTS.md` §2 - временное правило для теста резолва переменных. В начале каждой сессии агент выводит блок настроек командой `AGENT_RUNTIME=<id> AGENT_RUNTIME_CONFIG=.agents/runtime/<id>/config.json node .agents/runtime/guard.mjs settings`. Режим `settings` guard'а печатает рантайм, адаптер и `hooksSupport`, guard-команду, активный профиль (`AGENT_PROFILE`, по умолчанию `default`), маппинг tier→модель с флагом verified, лимиты (с учётом переопределений профиля), права и verification-команды. Метка "NOT verified" у модели или несоответствие адаптера таблице §1 - сообщается пользователю до начала работы. Раздел и режим подлежат удалению после окончания теста.

## Движок политики guard

`guard.mjs` читает JSON-payload из stdin (`{"tool_name": ..., "tool_input": ...}`). Exit-код 0 разрешает вызов (warn-правила печатаются в stderr); exit-код 2 блокирует его. Сообщение блока содержит id правила, причину и строку `Instead:` с разрешённой альтернативой. Payload, который не парсится как JSON, пропускается (fail-open) - повреждённый ввод не должен блокировать работу.

Имена инструментов вендоров нормализуются через `TOOL_ALIASES` (Cursor `Shell`/`Delete` → `Bash`, ZCode `ApplyPatch` → `Edit`, `Task` → `Agent`; у OpenCode - строчные); `Delete` в Cursor превращается в эквивалент команды `rm -rf <path>`.

Движок держит два упорядоченных списка правил: `check()` сначала оценивает `BLOCK`, затем `WARN`, и возвращает первое совпадение. Id блок-правил:

- Shell: `shell.rm-rf-root`, `shell.rm-rf-worktree`, `shell.rm-rf-outside-allowlist`, `shell.git-force-push` (разрешён только `--force-with-lease`), `shell.history-rewrite`, `shell.chmod-777`.
- Данные: `db.drop`, `db.delete-without-where`, `prisma.reset`.
- Секреты и защищённые файлы: `secrets.read`, `secrets.read-tool`, `write.secret-path`, `write.protected-path`, `net.pipe-to-shell`.
- Инфраструктура и подтверждения: `infra.production`, `deploy.prod-apply`, `deploy.destructive`, `gate.answer-by-agent`, `approval.by-agent`.
- Структура: `structural.guard-mutation` (warn-уровень - `structural.agents-mutation`).

Ключевые константы движка:

- Рекурсивное удаление разрешено только под `.agents/.tmp/`, `/tmp/`, `/private/tmp/`, `.nx/` и `node_modules/` (`RM_ALLOWLIST`).
- Защищённые от записи цели: `.git/`, `node_modules/`, `bun.lock` и `package-lock.json` (`PROTECTED_WRITE`).
- Пути секретов совпадают с `.env*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `.ssh/`, `secrets/`, `credentials.json` (`SECRET_PATH`).
- Изменения под `.agents/roles|skills|runtime|agents` - структурные (`STRUCTURAL_AREAS`, warn); изменение исходника guard, политики или реестра write-set - блок, снимаемый только пользователем (`STRUCTURAL_GUARD_FILES`).
- Worktree под `.agents/.worktrees/` удаляется командой `bun run worktree:remove <slug>`, не `rm` - иначе остаётся регистрация git.
- Warn-правила дополнительно: `deploy.billable`, `shell.git-hard-reset`, `shell.git-clean`, `shell.sudo`.

Перед сомнительной командой агент прогоняет payload через guard вручную:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"<команда>"}}' | node .agents/runtime/guard.mjs
```

Каждый vendor-конфиг хранит `guard.verifyCommand` - самопроверку guard на своём рантайме (ожидается exit 2 и причина в stderr).

## Модели, лимиты и профили

Каждый vendor-конфиг маппит четыре tier (`fast`, `standard`, `strong`, `subagents`) на модель и `thinkingLevel` (`low`/`medium`/`high`/`max`; у zcode для `standard`/`strong`/`subagents` - `max`). Для Claude это claude-sonnet-5-5, claude-opus-5-5 и claude-fable-5-1 (`.agents/runtime/claude/config.json`); полная таблица по всем рантаймам - `AGENTS.md` §4. Модель с `verified: false` (все рантаймы, кроме claude и zcode) подтверждается у пользователя в таком рантайме на первом запуске, затем значение вписывается обратно в конфиг. OpenCode - bring-your-own-provider: фактические модели определяются провайдерами пользователя, значения в конфиге - предполагаемое отображение. Консоль сообщает проблему, когда все модели рантайма не верифицированы.

Общие `limits` задают рабочий бюджет: `repairAttempts` 3, `maxParallelAgents` 4, `wipLimit` 4, `decisionTreeDepth` 4, `researchPasses` 2, `architecturePasses` 2, `reviewPasses` 2, `rootCauseDepth` 5, `requiredReadingBytes` 118000, `referenceTopics` 3. Три профиля переопределяют их и задают `defaultModel`; активный выбирается переменной `AGENT_PROFILE` (по умолчанию `default`):

| Профиль | defaultModel | Отличия лимитов |
|---|---|---|
| `fast` | fast | `repairAttempts` 2, `rootCauseDepth` 3, `decisionTreeDepth` 2, параллелизм и WIP 2, проходы 1 |
| `default` | standard | базовые значения |
| `deep` | strong | `repairAttempts` 5, `rootCauseDepth` 7, `decisionTreeDepth` 6, параллелизм и WIP 6, проходы 3 |

Превышение лимита - сигнал остановиться и эскалировать пользователю либо упростить план, а не ошибка.

## Права

`AGENTS.md` §8 разрешает коммиты (`git.commit: true`) и запрещает push и force-push в любом режиме (`git.push: false`, `git.forcePush: false`). Когда задача выполнена и проверки пройдены, агент коммитит с сообщением по Conventional Commits (`<type>(<scope>): <описание>`); при упавшей проверке коммита нет. Shell всегда `policy-guarded` - под политикой guard'а. Структурные изменения (`.agents/roles|skills|runtime|agents`, правка guard) делаются всегда с явного одобрения пользователя. MCP-серверы - только из списка `permissions.mcp` конфига рантайма.

Общее правило добавления инструментов (`AGENTS.md` §10, «Правило поддержки»): если изменение начинает использовать новый внешний инструмент или библиотеку, отсутствующую в npm-зависимостях воркспейса (CLI, бинарь, глобальный npm-пакет, системная утилита вне базового набора ОС) - в той же серии коммитов его оформляют плагином консоли (`core/tools/<id>.ts` + строка в реестре `core/tools.ts`; гайд - `docs/tools-dev.md`) и синхронно обновляют `tooling/scripts/tool.sh` (диспетчер агентов), `tooling/scripts/setup.sh` (статус и установка) и `docs/tools.md`.

## Верификация

`tooling/scripts/src/verify.ts` исполняет команды, названные в общем `verification` (точки входа - `bun run tooling/scripts/src/verify.ts <sub>`):

| Контекст | Команда | Шаги |
|---|---|---|
| после каждого изменения | `verify-fast` | `nx run @harness/tooling:test`, `nx run @harness/tooling:validate`, самопроверка guard |
| перед слиянием/интеграцией | `verify-integration` | `nx run-many -t test,validate` для `@harness/console` и `@harness/tooling`, самопроверка guard |
| перед релизом / работа с секретами | `verify-security` | объявлена в конфиге; в этом срезе репозитория `verify.ts` сообщает её недоступной (exit 1) |
| приёмочное тестирование поставки | `verify-e2e` | то же - недоступна в этом срезе |

Самопроверка guard отправляет `rm -rf /` в guard под текущим `AGENT_RUNTIME` и ожидает exit-код 2. Скрипт вызывает `node_modules/.bin/nx` напрямую (bunx при отсутствии пакета начал бы его скачивать) и падает с сообщением `bun install`, когда `nx` не установлен. Если команда недоступна (tooling отсутствует в срезе репозитория), агент обязан сообщить пользователю что проверить не удалось и что проверено вручную.

## Связанные страницы

- [Обзор архитектуры](overview.md) - консоль и точки входа адаптеров.
- [Сессии, скиллы и провайдеры](sessions-skills-providers.md) - источники сессий рантаймов.
- [Реестр инструментов экономии контекста](tools-registry.md) - хуки индексов, работающие рядом с guard.
