# Оптимизация обвеса

Раздел "Настройки → Оптимизация" консоли. Кроме отчётов Claude Insights и CodeBurn (рекомендации по статистике использования, `core/optimization.ts`) содержит три механизма улучшения обвеса агента, перенятые из подхода рекурсивного харнессинга (harness2): накопление уроков между задачами, оценку навыков по evals-кейсам и контрастивные пробы вариантов обвеса. Четвёртый механизм - методологический workflow Harness Refinement.

## Библиотека уроков

Постоянное хранилище `.agents/lessons/` (аналог improvement harness): уроки накапливаются между задачами и внедряются в новые прогоны.

- Источники: lessons-артефакты прогонов (`.agents/console/tasks/<run-id>/lessons/proposals.md`) и ретроспективы спринтов (`.agents/sprints/*-retrospective.md`). Кнопка "Собрать из прогонов" (`POST /api/lessons {action:"collect"}`) агрегирует предложения идемпотентно: отпечаток записи - заголовок + источник + цель; существующая запись не перезаписывается.
- Формат записи `LESSON-<16 hex>.yaml` (`kind: Lesson`): title, statement (решающее правило "При [условие] выполняй [действие], потому что [эффект]"), reason, target, domain (role|skill|workflow|runtime|repo), status (proposed|adopted|rejected), provenance {source, runId, sprintId, fingerprint}.
- Решение оператора: `POST /api/lessons/<id>` меняет статус из proposed; при принятии можно задать statement.
- Внедрение: движок workflow (`sectionPrompt` в `core/workflows/engine.ts`) добавляет в задание каждой секции блок "Принятые уроки" из принятых записей (лимит 2 КБ, по убыванию свежести). Недоступная библиотека не ломает прогон.

## Оценка навыков (evals)

Исполнитель кейсов `evals/evals.json` master-навыков с судьёй-провайдером (`core/skillEvals.ts`).

```
каталог навыков → кейс (SKILL.md + prompt) → исполнитель (headless-рантайм | provider)
                                                     ↓ вывод
                                        судья-провайдер (утверждения кейса)
                                                     ↓
                        report.json / report.md в .agents/console/tasks/<id>/skill-evals/
```

- Запуск: `POST /api/skills/evals {skillIds, runtimes}` создаёт задачу (kind `skill-evals`) и отвязанный процесс `apps/console/src/skill-evals-runner.ts`; прогресс пишется в report.json после каждого кейса.
- Исполнители: любой headless-рантайм адаптера или `provider:<id>` (исполняется в процессе раннера). Кейсы одного прогона идут последовательно.
- Судья: провайдер задачи "Оптимизация" (`settings.taskRuntimes.optimization`, иначе провайдер по умолчанию). Вердикт - строгий JSON: pass, разбор каждого утверждения, комментарий.
- Сравнение рантаймов: один набор кейсов по нескольким исполнителям, сводка pass-rate по навыку (`summarizeReport`).

## Контрастивные пробы

Метод propose-probe-compose: одна задача выполняется в нескольких вариантах обвеса в изолированных worktree, поведение сравнивается провайдером без эталона (`core/probing.ts`).

```
задача + варианты (propose: провайдер по задаче и принятым урокам | вручную)
   ↓
N × git worktree .agents/.worktrees/probe-<id>-<n> + замены файлов варианта (probe)
   ↓ параллельные headless-запуски (cwd = worktree варианта)
контрастный отчёт провайдера + рекомендация варианта (compose)
   ↓
внедрение выбранного варианта агентом рантайма (adopt, оператор)
```

- Вариант: {id, label, contextBlock (блок дополнительных инструкций в промпт), fileOverrides}. Whitelist замен: `.agents/roles/**`, `.agents/skills/**/SKILL.md`, `AGENTS.md`; не более 4 файлов и 4 вариантов в пробе.
- Запуск: `POST /api/optimization/probe/run` создаёт задачу (kind `probe`) и процесс `apps/console/src/probe-runner.ts`; после каждого варианта обновляется probe.json, в конце пишется контрастный отчёт.
- Рекомендация: провайдер возвращает Markdown-отчёт и блок ```json {"variantId","rationale"}; вариант с ошибкой исполнения не рекомендуется.
- Внедрение: `POST /api/optimization/probe/<id> {action:"adopt"}` запускает агента рантайма на применение замен варианта в основной рабочей папке. Правки `.agents/roles|skills` проходят guard-правило structural.agents-mutation (warn) - одобрение оператора в сессии рантайма.
- Очистка: worktree вариантов удаляются штатным скриптом `bun run worktree:remove <slug> --force`; ветки `probe-*` остаются для проверки оператором.

## Workflow Harness Refinement

Методология рекурсивного рефайнмента как запускаемый workflow (`.agents/skills/master/workflows/harness-refinement.yaml`, роль `harness-curator` в `.agents/roles/product/`). Узлы: evidence (свидетельства из прогонов и библиотеки уроков) → propose (изменения восьми компонентов обвеса: системный промпт AGENTS.md, guardrails, память, tool guidance, роли, навыки, скрипты, плагины) → probe (сценарии контрастивных проверок; запуск проб выполняет оператор в консоли) → compose (итог: принятые изменения, новые уроки в формате решающих правил для библиотеки). Запуск - `/workflow:harness-refinement` в direct-чате вкладки "Агент".

## Ограничения текущей реализации

- Usage и стоимость точны только у рантаймов с машинным конвертом (claude `--output-format json`, codex `--json`); у остальных в отчётах фиксируются текст, длительность и отметка "стоимость неизвестна".
- Пробы и evals исполняются последовательными кейсами/вариантами внутри задачи; варианты одной пробы параллельны как отдельные процессы (потолок - 4 варианта).
- Наполнение библиотеки уроков - вручную кнопкой "Собрать из прогонов"; автосбор после каждого прогона не выполняется.
- Замены файлов вариантов применяются только в worktree пробы; основной репозиторий меняет исключительно агент внедрения по команде оператора.

## Файлы и API

| Ресурс | Назначение |
|---|---|
| `.agents/lessons/LESSON-*.yaml` | Записи библиотеки уроков (`kind: Lesson`) |
| `.agents/console/tasks/<id>/skill-evals/` | Отчёты прогона evals (report.json, report.md) |
| `.agents/console/tasks/<id>/probe/` | Проба (probe.json: варианты, результаты, контраст, рекомендация) |
| `core/lessonsLibrary.ts`, `core/skillEvals.ts`, `core/probing.ts` | Ядро механизмов |
| `apps/console/src/skill-evals-runner.ts`, `apps/console/src/probe-runner.ts` | Отвязанные процессы оркестрации |
| `GET/POST /api/lessons`, `POST /api/lessons/<id>` | Библиотека уроков: список, сбор, решение |
| `GET/POST /api/skills/evals` | Каталог evals, сводки, запуск прогона |
| `GET/POST /api/optimization/probe`, `POST /api/optimization/probe/run`, `GET/POST /api/optimization/probe/<id>` | Пробы: сводки, предложение вариантов, запуск, отчёт, внедрение |
| `bun run worktree:remove <slug> [--force]` | Штатное удаление worktree (пробы и спринты) |
