---
type: "Справочник"
title: "Быстрый старт"
description: "Точка входа в репозиторий harness: карта путей верхнего уровня, установка и запуск консоли Harness (порт 3000, правило одного инстанса), команды верификации verify-fast/verify-integration, ключевые правила guard для агентов и маршрутизация по разделам вики."
tags: [quickstart, onboarding, console, guard, verification]
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T21:39:07.719Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-f4db25cff09296978010365f
    resource: repo://apps/console/package.json
  - id: openwiki-source-be5a2712277c9b31ad9209ec
    resource: repo://apps/console/README.md
  - id: openwiki-source-6ee35d2786b640da8a5cec35
    resource: repo://apps/console/src/app/api/agent/chat/route.ts
  - id: openwiki-source-dfca20f395e9b0c18da1b5e7
    resource: repo://apps/console/src/app/api/git/branch/route.ts
  - id: openwiki-source-7d3ffa371b4b69d7aab842a6
    resource: repo://apps/console/src/app/api/git/init/route.ts
  - id: openwiki-source-cd5cb13d962a00704c3bdb36
    resource: repo://apps/console/src/app/api/git/status/route.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-558dc5f42cc888f9c23a0cc5
    resource: repo://tooling/scripts/setup.sh
  - id: openwiki-source-46d460b296699fb9f8cef632
    resource: repo://tooling/scripts/src/verify.ts
generated: { by: "openwiki/0.6.1", at: "2026-10-01T21:39:07.719Z" }
---

# Быстрый старт

`harness` — репозиторий, объединяющий общую политику для рантаймов AI-агентов с веб-приложением — консолью Harness (`apps/console`), которая этими рантаймами управляет. Поддерживаются шесть рантаймов: Claude Code, Codex CLI, ZCode, Cursor, Kimi Code и OpenCode.

## Что в репозитории

| Путь | Содержимое |
|---|---|
| `AGENTS.md` | Канонические инструкции для каждого рантайма (на русском) |
| `.agents/runtime/` | Общий `config.json`, конфиги рантаймов и движок политики guard `guard.mjs` |
| `apps/console/` | Консоль на Next.js 16: вкладка «Агент» с диалогом и задачами, дашборд, реестр MCP, навыки, сессии, процессы, рабочие папки, память, инструменты |
| `tooling/harness/` | Обёртка хуков для индексных инструментов (CLI `cli.ts`, реестр, валидация, doctor) |
| `tooling/scripts/` | `setup.sh`, диспетчер `tool.sh` и точка входа верификации `verify.ts` |
| `docs/` | Документация проекта на русском; индекс — `docs/README.md` |
| `openwiki/` | Эта вики |

Корневой `package.json` определяет Bun-воркспейс (`apps/*` и `tooling/harness`) со скриптами `setup`, `console`, `console:build`, `console:test`, `validate:hooks` и `harness-doctor`. Пакет консоли `@harness/console` собран на Next.js 16 и React 19; его runtime-зависимости включают `@ai-sdk/openai-compatible`, `@ai-sdk/react` и `ai` (AI SDK — путь исполнения «Провайдер» во вкладке «Агент»), `@json-render/core` и `@json-render/react` (рендер UI-спек в ответах агента), а также `zod` и `zustand`.

## Установка и запуск

1. Выполните `bash tooling/scripts/setup.sh` (или `bun run setup`) для проверки и установки системных инструментов: bun, Node 22 или новее и опциональных инструментов. Скрипт запрашивает подтверждение.
2. Выполните `bun install` в корне репозитория.
3. Выполните `bun run console`. Dev-сервер слушает `http://localhost:3000` (скрипт `dev` — `next dev -p 3000`). README требует единственный инстанс: если порт занят, не запускайте второй сервер — проверьте, какой процесс слушает порт (`lsof -i :3000 -sTCP:LISTEN`), и пользуйтесь уже запущенной консолью либо остановите чужой процесс.

Прочие команды: `bun run console:build` (production-сборка; сначала остановите dev-сервер), `bun run console:test` (`bun test`), `bun run validate:hooks`.

Первый пункт навигации консоли — вкладка **«Агент»** (`/agent`): стриминговый диалог с выбором исполнителя (провайдер AI SDK или headless-рантайм), модели по tier'ам и effort, рабочей папки и ветки git. Запросы идут в `POST /api/agent/chat`, а состоянием папки управляют маршруты `/api/git/status`, `/api/git/init` и `/api/git/branch`. Подробности — на странице [Вкладка Агент, реестр задач и git рабочих папок](architecture/agent-panel-tasks-git.md).

## Верификация

Команды берутся из блока `verification` в `.agents/runtime/config.json` и исполняются через `tooling/scripts/src/verify.ts`:

| Команда | Когда |
|---|---|
| `bun run tooling/scripts/src/verify.ts verify-fast` | После каждого изменения |
| `bun run tooling/scripts/src/verify.ts verify-integration` | Перед слиянием |

`verify-fast` прогоняет тесты tooling и `validate` плюс самопроверку guard (заведомо блокируемый payload `rm -rf /` должен дать exit 2); `verify-integration` — `nx run-many -t test,validate` по проектам `@harness/console` и `@harness/tooling`. `verify-security` и `verify-e2e` объявлены в конфиге, но `verify.ts` сообщает, что они недоступны в этом срезе репозитория. Подробности: [Рантаймы агентов, Guard и верификация](architecture/agent-runtime-and-guard.md).

## Правила для агентов

- Все shell- и файловые вызовы проходят политику guard. Рекурсивное удаление разрешено только в `.agents/.tmp`, `/tmp`, `.nx` и `node_modules`; секреты не читаются и не пишутся; push запрещён всегда.
- Изменения в `.agents/roles|skills|runtime|agents` требуют предварительного одобрения пользователя; правка самого guard блокируется.
- Временные файлы размещаются в `.agents/.tmp`.
- Документация в `docs/` обязана соответствовать коду и обновляется в той же серии коммитов, что и фича.

## Куда читать дальше

- [Обзор архитектуры](architecture/overview.md): слои, API-маршруты, состояние консоли.
- [Вкладка Агент, реестр задач и git рабочих папок](architecture/agent-panel-tasks-git.md): `/agent`, `POST /api/agent/chat`, реестр задач и `/api/git/*`.
- [Сессии, навыки и провайдеры](architecture/sessions-skills-providers.md): история сессий, навыки, провайдеры LLM.
- [Память, OpenWiki и вики-воркспейсы](architecture/memory-and-openwiki.md): сборка вики и рабочие папки.
- [Реестр MCP и синхронизация конфигов](architecture/mcp-sync.md): как MCP-серверы попадают в конфиги рантаймов.
- [Рантаймы агентов, Guard и верификация](architecture/agent-runtime-and-guard.md): конфиги рантаймов, правила guard, лимиты.
- [Реестр инструментов экономии контекста](architecture/tools-registry.md): плагины инструментов, `tool.sh`, хуки.
