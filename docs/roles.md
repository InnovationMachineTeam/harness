# Роли

Роль - один файл `.agents/roles/<папка>/<id>.md`: YAML frontmatter и markdown-инструкции. Каталог содержит 64 роли в папках `product/` (16), `execution/` (4) и `engineering/` (44); ссылка на роль в шаге workflow - по `id`. Execution-роль описывает способ выполнения (`workflow-coordinator`, `task-worker`, `independent-reviewer`, `research-subagent`) и комбинируется в массиве `roles` шага с продуктовой или инженерной ролью.

Engineering-каталог разбит по доменам: frontend (web, iOS, Android, cross-platform, design system, accessibility, performance), backend (API, services, realtime, auth, performance), data (engineering, architecture, database, analytics, quality, governance), AI (agents, ML, LLM, retrieval, evaluation, MLOps), integration (MCP, API, events, identity, automation), platform (general, DevOps, SRE, cloud, observability, developer experience), security (general, application, cloud, privacy, operations) и quality (general, automation, performance, accessibility).

## Frontmatter

| Поле | Назначение |
|---|---|
| `id` | Идентификатор роли; уникален в пределах `.agents/roles` |
| `title` | Название для карточек и селекторов |
| `domain` | Домен для группировки (`product`, `frontend`, `security` и другие) |
| `skills` | Обязательные internal skills роли; их содержимое инжектится в промпт шага |
| `mcp` | MCP-серверы, которые роль использует |
| `tools` | CLI-инструменты роли (например `open-design`) |
| `defaultTier`, `defaultEffort` | Значения по умолчанию для шага, не задавшего tier/effort |

## Секции markdown-тела

Тело файла целиком попадает в промпт шага. Канонические секции:

- `# Роль` - назначение и границы ответственности.
- `## Правила работы` - типовые работы и пошаговые алгоритмы; указано, какие навыки, MCP и инструменты применяются на каждом шаге.
- `## Принципы работы` - как действовать, если задача не подходит ни под один алгоритм.
- `## Оценка входных данных` - критерии проверки входных артефактов; что вернуть поставщику при неполноте.
- `## Оценка своей работы` - критерии самооценки результата до завершения шага.

Каждый алгоритм перечисляет обязательные и опциональные capabilities, fallback, результат и критерий завершения. Во frontmatter находятся только обязательные зависимости. Например, UX-роль использует цепочку Claude Design → Open Design → Figma → текстовый UX-артефакт, но не блокируется жёсткой зависимостью от конкретного дизайн-провайдера.

Шаг workflow ссылается на одну или несколько ролей: инструкции всех выбранных ролей идут в один промпт (см. [workflows.md](workflows.md)). Preflight проверяет существование роли и доступность обязательных skills, MCP и tools. Результат проверки подчиняется наследуемой capability policy.

## Редактирование

Console ("Роли"): папки селектором, карточки ролей, создание роли в папке, модальный редактор (форма frontmatter + markdown-тело + исходник файла). Сохранение файла защищено ETag; конфликт возвращает HTTP 409 с текущим текстом.

Internal skills находятся в мастер-каталоге `.agents/skills/master/skills` (каталоги с `manifest.yaml`; путь - `privateSkillRoot` из `.agents/runtime/config.json`) и не попадают в native slash-меню рантаймов. Console раскрывает `/master:<id> <промт>` (мастер-навык, в том числе из `skills` роли), `/agent:<id> <промт>` и `/workflow:<id> <промт>` на сервере или клиенте перед запуском ([skills.md](skills.md)). Роль подключает навык полем `skills`; содержимое SKILL.md раскрывается в промпте шага, а при обращении `/agent:<id>` в direct-чате - вместе с ролью.

## Роли как агенты в direct-чате

Slash-меню композера "Агент" содержит группу "Агенты": вставка `/agent:<id>` в промт подключает роль к реплике. Console разворачивает роль и её master skills: для runtime-исполнителя - блоки `[Harness agent]` и `[Harness master skill]` в промте; для provider-исполнителя - роль и навыки в системный промт. В режиме workflow группа скрыта: агенты выбираются в узлах, `/agent:` в запросе запуска отклоняется.
