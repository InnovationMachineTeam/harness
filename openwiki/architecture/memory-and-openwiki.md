---
type: "Справочник"
title: "Память, OpenWiki и вики-воркспейсы"
description: "Вкладка «Память» (/memory) консоли: документы рабочих папок, вики OpenWiki и memory-файлы рантаймов; два режима сборки вики (CLI и агентский), статус сборки, визуализатор и реестр мультирепозиторных вики-воркспейсов."
tags: ["memory", "openwiki", "wiki", "console", "workspaces"]
openwiki_generated: true
sources:
  - id: openwiki-source-3a41d67a7655a83efd921cdb
    resource: repo://apps/console/src/app/api/memory/openwiki/build/route.ts
  - id: openwiki-source-2681f253b48d1db2e74b2764
    resource: repo://apps/console/src/components/memory/OpenWikiTab.tsx
  - id: openwiki-source-5e815fd31993c125b7b9662e
    resource: repo://apps/console/src/core/memory.ts
  - id: openwiki-source-3ee26de5ed3de3da39cce041
    resource: repo://apps/console/src/core/openwikiWorkspaces.ts
  - id: openwiki-source-89702409219515a781c0ff96
    resource: repo://apps/console/src/core/prompts.ts
generated: { by: "openwiki/0.6.1", at: "2026-10-01T21:22:27.721Z" }
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T21:22:27.721Z
---

# Память, OpenWiki и вики-воркспейсы

Маршрут консоли `/memory` (вкладка «Память») показывает три вида файловой памяти для папок, включённых пользователем в консоли: markdown-документы рабочих папок, вики OpenWiki в `<папка>/openwiki/` и memory-файлы рантаймов. Вкладка читает всё с диска и не держит собственного хранилища. Тот же список файлов повторяется внутри представления каждого рантайма на `/runtime/<id>`. Логика живёт в `apps/console/src/core/memory.ts`, роуты — в `apps/console/src/app/api/memory/` (`docs`, `file`, `graphify`, `openwiki`, `runtimes`).

## Режимы сборки OpenWiki

Папка участвует в сборке, когда включён её переключатель OpenWiki (`state.workspaces.openwiki`). Вкладка предлагает два режима сборки.

| Режим | Исполнитель | Точка входа |
|---|---|---|
| CLI | Внешний `openwiki` CLI, запущенный как detached-процесс | `startWikiBuild` |
| Агентский | Headless-сессия рантайма с интеграцией openwiki | `startWikiBuildViaAgent` |

Роут `POST /api/memory/openwiki/build` принимает `{dir, via?: "cli" | "agent", runtime?}`, отклоняет папки вне списка рабочих и возвращает 409 «сборка уже идёт», если `readBuildMeta` даёт мету с живым pid (`processAlive`); оба режима используют один план `resolveWikiBuildPlan`.

### Режим CLI

`startWikiBuild` спавнит `openwiki` без оболочки — пользовательский ввод в команду не попадает. Аргументы: `--language <язык>`, `--init` или `--update` и строка-инструкция модели «Веди вики на русском языке.». Процесс отвязанный (`detached: true`, `unref()`), весь его вывод идёт в `openwiki/.console-build.log`, а pid, режим и время старта — в `openwiki/.console-build.json`. Переменные окружения LLM-провайдера приходят из `state.openwikiLlm` через `openwikiLlmConfig`/`openwikiLlmEnv` (см. `core/openwikiLlm.ts`). Если передан контекст задачи, сборка дополнительно регистрируется в реестре задач (kind `openwiki-build`), который показывает вкладка «Мониторинг».

`resolveWikiBuildPlan` выбирает режим и язык по состоянию папки:

- Нет `openwiki/index.md` — режим `init`; иначе — `update`.
- Целевой язык консоли жёстко задан как `ru` в `wikiBuildPlan` (AGENTS.md §10). Прерванная сборка (в `.last-update.json` статус `"interrupted"` и существует `.run.json`) блокирует смену языка: CLI требует resume в том же режиме и языке, поэтому сборка продолжается в режиме и языке прерванной, а следующее «Обновить» переведёт вики на целевой `ru`. В этом случае в ответ добавляется `resumeNote` с пояснением.

Так, эта вики сейчас ведётся на русском: в её `openwiki/.last-update.json` записан язык `ru`.

### Агентский режим

Агентский режим запускает headless-сессию рантайма через `launchAgentWikiBuild` из `core/prompts.ts`; `startWikiBuildViaAgent` лишь готовит каталог, делегирует запуск и пишет мету. Промпт собирается из структурированных полей (режим/язык берутся из плана `wikiBuildPlan`, свободный текст пользователя в spawn не попадает) и требует использовать навык openwiki и MCP-инструменты жизненного цикла: `openwiki_begin` → `openwiki_submit_plan` → `openwiki_next_page` → (исследование и запись страницы) → `openwiki_submit_page` → … → `openwiki_finish`. Состоянием прогона владеет OpenWiki (`.run.json`, claims-файлы в `.claims/`). Агент пишет страницы своей моделью, а его запуск идёт через проверенный whitelist команд адаптера (`claude -p`, `codex exec`, `kimi -p`, `opencode run`, `node …-p`). Агентский режим пишет тот же `.console-build.json` и лог-файл, что и CLI-режим, поэтому вкладка показывает единый статус «сборка…» для обоих, а задача попадает в реестр с исполнителем-рантаймом и ссылкой на сессию.

Интеграционный скилл ищется в проектном каталоге рантайма (`wikiIntegrationDir`):

| Рантайм | Каталог скилла |
|---|---|
| claude | `.claude/skills/openwiki` |
| codex | `.agents/skills/openwiki` |
| opencode | `.opencode/skills/openwiki` |
| cursor | `.cursor/skills/openwiki` |

У остальных рантаймов каталога интеграции нет (`wikiIntegrationDir` возвращает `null`). Роут дополнительно требует: у рантайма должен быть headless-запуск (`adapter.runCommand`), установленная проектная интеграция openwiki, а папка должна быть git-корнем — `openwiki_begin` резолвит вики git-корня от cwd, поэтому вложенная рабочая папка (например, `docs/` внутри корня репозитория) в агентском режиме отклоняется с подсказкой использовать CLI-режим. Согласно `docs/operations.md`, у Cursor нет headless-запуска из консоли.

## Файлы вики и статус

`wikiDir(workspaceDir)` — это `<папка>/openwiki`. Файлы, которые пишут инструменты:

| Файл | Кто пишет | Содержимое |
|---|---|---|
| `index.md` | openwiki | Индекс вики; его отсутствие выбирает `init` |
| `.run.json` | openwiki | Возобновляемое состояние прогона |
| `.last-update.json` | openwiki | Метка генерации: `status`, `command`, `language` |
| `.console-build.json` | консоль | pid, режим, время старта |
| `.console-build.log` | консоль или агент | Вывод сборки |
| `.page-manifest.json`, `.claims/` | openwiki | Манифест страниц и claims по страницам |

`wikiStatus` объединяет эти файлы: дерево страниц без dot-файлов, число страниц, дату генерации из `.last-update.json`, признак идущей сборки и хвост лога. `processAlive` проверяет сохранённый pid через `kill(pid, 0)`; ошибка `EPERM` трактуется как «процесс жив, но чужой». Компонент `OpenWikiTab` (`components/memory/OpenWikiTab.tsx`) загружает `/api/memory/openwiki` и опрашивает его каждые 4000 мс, пока хотя бы в одной включённой папке идёт сборка.

## Статический визуализатор

Кнопка «Граф» экспортирует статический визуализатор командой `openwiki visualize openwiki --export <папка>/openwiki/.visualizer` — литеральный spawn без оболочки, без LLM и без сетевых вызовов. `VISUALIZER_FILES` — фиксированный список из пяти файлов (`index.html`, `client.js`, `client-lib.js`, `styles.css`, `graph.json`). `syncVisualizerPublic` копирует их в `apps/console/public/visualizers/<slug>/`, где slug — стабильные 12 hex-символов sha256 от пути папки (пути не передаются через URL), а Next.js раздаёт их как статику в iframe с того же origin; `pruneVisualizerPublic` удаляет слаги, не соответствующие активным папкам. `resolveVisualizerFile` возвращает `null` для любого имени вне списка. `visualizerStatus` помечает граф устаревшим (`stale`), если `graph.json` старше самого свежего `*.md` вики.

## Вики-воркспейсы

`core/openwikiWorkspaces.ts` правит мультирепозиторный реестр OpenWiki `~/.openwiki/wiki-workspaces.json` (или `$OPENWIKI_CONFIG_DIR`). Команда `openwiki link` — интерактивный TUI, неинтерактивного пути в CLI нет, поэтому консоль редактирует реестр напрямую с теми же правилами:

- Форма реестра: `version`, `wikis` (`id`, `name`, абсолютный `root`), `workspaces` (`id`, `name`, `wikis`), `active` (`wiki`, `workspace`).
<!-- openwiki: broken internal link [?:[a-z0-9-]{0,62}[a-z0-9]] file "?:[a-z0-9-]{0,62}[a-z0-9]" does not exist. Fix the href or restore the target, then delete this comment. -->
- Идентификаторы — слаги (`/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/`), из русских имён слаг строится транслитерацией (`wikiIdFromName`). Воркспейс содержит минимум две вики. Вики — git-репозиторий с маркером `openwiki/.last-update.json` (`wikiRootFor`).
- `readWorkspaceRegistry` возвращает `null` для отсутствующего или невалидного файла. Запись атомарная (временный файл и rename, права 0600), каталог создаётся с правами 0700.
- Операции: `createWorkspace` (добавляет незарегистрированные вики и отклоняет повторы имён), `setActiveWorkspace` (аналог `workspace use` и `clear` — правка поля `active`), `deleteWorkspace` (вики остаются в реестре) и `workspaceOverview` для вкладки. Роут — `/api/memory/openwiki/workspaces` с действиями `link`/`use`/`clear`/`delete`.

Воркспейсы влияют только на области поиска `openwiki_search`: состав и активность используются openwiki для поиска по нескольким репозиториям и не влияют на `--init`/`--update`. Когда репозиторий входит в несколько воркспейсов, поиску нужен активный воркспейс.

## Настройки LLM-провайдера

`core/openwikiLlm.ts` отображает `state.openwikiLlm` и `state.graphifyLlm` в переменные окружения (`openwikiLlmEnv`, `graphifyLlmEnv`) и аргумент `--backend` для Graphify (`graphifyBackendArg`). Пресеты (OpenAI-совместимый провайдер по умолчанию — локальный Ollama) описаны в `core/llmPresets.ts`; провайдер выводится из реестра провайдеров — см. [Сессии, скиллы и провайдеры](sessions-skills-providers.md).

## Graphify

Второй переключатель (`state.workspaces.graphify`) включает сборку графа знаний CLI `graphify`; механика зеркалит OpenWiki (детект CLI → detached-сборка с pid-метой и логом → публикация `graph.html` статикой), граф пишется в `<папка>/graphify-out/`. Роуты — `app/api/memory/graphify`. Корпус только из кода собирается без LLM-ключа; корпус с документами, статьями или изображениями требует LLM-бэкенда. Graphify также оформлен как плагин-инструмент — см. [Реестр инструментов экономии контекста](tools-registry.md).

## Безопасное чтение файлов

Роут `file` читает через `readPolicy` и `checkReadPath`. Политика разрешает только абсолютные лексически нормализованные пути, которые после `realpath` остаются внутри разрешённых корней, отклоняет скрытые компоненты пути относительно корня и ограничивает размер потолком `MAX_READ_BYTES` (1 МиБ). Корни рабочих папок разрешают только markdown-файлы (`*.md|markdown|mdx`). Каталоги вики и memory-каталоги рантаймов (`~/.claude/projects/<slug>/memory`, `~/.codex/memories`) разрешают любые нескрытые файлы. `~/.claude/CLAUDE.md` разрешён как единственный дополнительный файл. Отдельные тесты проверяют, что symlink, ведущий за пределы корня, отклоняется, а `..` в строке пути не проходит лексическую проверку.

## Память рантаймов

`runtimeMemory` собирает файловую память по каждому vendor-рантайму реестра. Сегодня файловую память пишут Claude (`~/.claude/projects/<slug>/memory` по каждой рабочей папке плюс глобальный `~/.claude/CLAUDE.md`) и Codex (`~/.codex/memories`; часть памяти Codex хранит в SQLite и консолью не читается). Для остальных рантаймов возвращается `supported: false` с пояснением (например, у Cursor память в SQLite `state.vscdb`).

## Связанные страницы

- [Обзор архитектуры](overview.md)
- [Агентские рантаймы, guard и верификация](agent-runtime-and-guard.md)
