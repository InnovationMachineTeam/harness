# Навыки

Навык - процедурное знание для агента (`SKILL.md` с frontmatter name/description). Публичные навыки skills.sh находятся в `.agents/skills` (корень `publicSkills` из `.agents/runtime/config.json`); внутренние навыки - в мастер-каталоге `.agents/skills/master/skills` (`privateSkillRoot`), группа дизайн-навыков - в `.agents/skills/design/skills` (`designSkillRoot`, лейбл `design`; панель "Навыки" раздела "Дизайн" - [design.md](design.md)), определения workflow - в `.agents/skills/master/workflows` (`workflowsRoot`). Каталог с `manifest.yaml` + `SKILL.md` - internal skill (доступен worker и Console; в нативные каталоги рантаймов попадает только через хук включения). Команды `/master:<id>`, `/agent:<id>`, `/workflow:<id>` и `@путь` раскрывает Console на сервере перед отправкой промта; для отдельно запущенных рантаймов master-навыки и workflow синхронизируются в нативные каталоги команд (раздел "Нативные команды рантаймов"). Все тогглы - оверлеи в `state.json` (подробнее: [architecture.md](architecture.md)).

Загрузчики читают пути из конфига (`core/runtimePaths.ts`): для корня репозитория - мастер-каталог с fallback на прежние пути (`.agents/skills`, `.agents/workflows`), для рабочих папок - только прежние пути. Повтор internal skill в корнях - берётся первый (master, затем design, затем legacy `.agents/skills`); группа записи - поле `group` (`master` | `design`). Публичные списки (`collectHarnessSkills`) исключают поддерево `master/` и `design/` и каталоги с `manifest.yaml`.

## Формат внутреннего навыка

`SKILL.md` внутреннего навыка соответствует формату Agent Skills. Frontmatter содержит `name`, `description` и маркер:

```yaml
metadata:
  internal: true
```

`name` совпадает с `manifest.id`, а `description` - с `manifest.description`. Манифест задаёт каталоговые данные Console, привязку к рантаймам, версию и теги автоматического выбора. Frontmatter сохраняет переносимость и явную классификацию самого навыка. Поле `metadata` не входит в `manifest.yaml`.

Каталог `evals/evals.json` содержит сценарии поведенческой проверки навыка. Каждый сценарий задаёт реалистичный `prompt`, ожидаемый результат и объективные `assertions`. Набор включает основной, пограничный и неопределённый или противоречивый случай. Eval-файлы не загружаются в промпт и не исполняются Console автоматически.

## Лейблы и единый список

Вкладка "Навыки" (настройки и пространство рантайма) показывает все навыки одним списком (`GET /api/skills/all`, `core/skillRegistry.ts`). У каждого навыка ровно один лейбл происхождения:

| Лейбл | Источник | Тоггл |
|---|---|---|
| `internal` | мастер-каталог (manifest.yaml) | да (`master:<id>`) |
| `design` | группа дизайн-навыков `.agents/skills/design/skills` (manifest.yaml) | да (`design:<id>`) |
| `runtime` | собственные глобальные каталоги рантайма | да (`<runtime>:<путь>`) |
| `skills.sh` | стандартная установка (запись в `skills-lock.json` или публичный каталог) | да (`harness:<имя>`) |
| `plugin` | имя числится в `skills` включённого установленного плагина | да (`harness:<имя>`) |
| `workflow` | определение workflow из каталога | нет - управление через workflow |

Список фильтруется сегментированными кнопками по лейблам. У каждого навыка - бейджи рантаймов, где он установлен; выключенный для рантайма бейдж показывается неактивным (effective - overlay тогглов). Скоуп подачи: в Настройках показываются все лейблы, кроме `runtime` (там только toggle глобальных навыков и репозиториевые навыки); в пространстве рантайма - только навыки, доступные этому рантайму (runtime-навыки его собственных каталогов, internal в его привязке, skills.sh/plugin с его симлинком; workflow не показывается - не привязан к рантайму).

## Хуки жизненного цикла

Правило размещения: каноническое хранилище навыков - `.agents/skills` (публичные - в корне, internal - `master/skills`, design - `design/skills`); каталоги нативных навыков рантаймов содержат только симлинки на канонические каталоги. Kimi симлинков не получает - он читает `.agents/skills` нативно.

Каждый навык обрабатывается хуками (`core/skillHooks.ts`), файловые операции выполняет `core/skillLinks.ts`. Жизненный цикл:

| Операция | Действие |
|---|---|
| Включить (toggle) | симлинк `.<runtime>/skills/<имя>` → канонический каталог для claude, codex, cursor, zcode, opencode + команды `hooks.enable` манифеста |
| Выключить (toggle) | снять симлинк (только указывающий в `.agents/skills`) + команды `hooks.disable` |
| Установить (skills.sh) | CLI кладёт канонический каталог в `.agents/skills/<name>`; после установки синк подключает симлинки по тогглам |
| Удалить | снять симлинки во всех рантаймах, удалить канонический каталог и lock-запись + hook `remove` |

Дополнительно исполняются команды `hooks` из манифеста:

```yaml
hooks:
  install: ["echo installed"]
  remove: ["echo removed"]
  enable: ["echo enabled"]
  disable: ["echo disabled"]
```

Команды исполняются общим исполнителем хуков (`core/lifecycleHooks.ts`: `bash -c`, таймаут 60 с) после guard-проверки репозитория (тот же движок политики, что PreToolUse-хуки: exit 2 - отказ). Хуки команд допустимы только у internal-навыков мастер-каталога; у skills.sh и plugin манифеста нет - поверхности нет. Тот же исполнитель обслуживает хуки MCP-серверов, плагинов и инструментов (`docs/mcp.md`, `docs/plugins.md`, `docs/tools.md`). Хук install выполняется после успешной установки skills.sh, hook remove - перед удалением. Выключенный internal-навык обрабатывается только раскрытием консоли (`/master:`), включённый - дополнительно нативно его рантаймом (симлинк). Лог - `.agents/console/skill-hooks.log`.

### Синк симлинков

`syncSkillLinks` (`core/skillLinks.ts`) приводит каталоги рантаймов к желаемому набору: желаемые симлинки создаются и перенацеливаются в канон, лишние управляемые симлинки и битые - удаляются, реальные каталоги канонических навыков уходят в бэкап `.agents/.tmp/skill-links-backup` и заменяются симлинками; записи без канонического аналога не трогаются. Исключения синка (`SKILL_LINK_EXCLUDED`) не трогаются никогда: `graphify` - рабочий каталог, его инсталлятор кладёт в каждый рантайм свой вариант. Синк выполняется при переключении навыков, установке и удалении; статус и ручная регенерация - Настройки → Навыки → панель "Симлинки навыков" (`GET`/`POST /api/skills/links`).

## Slash-меню композера "Агент"

`GET /api/slash-menu?executor=<id>&workflowId=<id>&workspace=<dir>` возвращает группы меню:

| Группа | Источник | Вставляемый токен |
|---|---|---|
| Навыки (/имя) | каталоги рантайма-исполнителя (`adapter.listSkills` - глобальные и проектные нативные каталоги) и публичные harness-навыки с эффективным тогглом; у провайдера - только harness-навыки | `/<name>` |
| Master skills | внутренние навыки (мастер-каталог и design-группа), привязка `manifest.runtimes` к исполнителю (`provider` и `provider:<id>` - валидные привязки) и эффективный тоггл (префикс `master:` / `design:` по группе) | `/master:<id>` |
| Workflow | каталог workflow (только direct-режим, перед агентами) | `/workflow:<id>` - запуск прогона |
| Агенты | роли `.agents/roles` (только direct-режим) | `/agent:<id>` |
| Навыки ролей workflow | master skills ролей выбранного workflow (режим workflow) | `/master:<id>` |

Раскрытие выполняет сервер (`resolvePromptCommands` в `core/workflows/skills.ts`): для рантайма - блоки `[Harness master skill]` и `[Harness agent]` в промте, токен `/<name>` остаётся нативным вызовом; для провайдера - роль, навыки и harness-навыки (`/<name>` раскрывается в блок `[Harness skill]` системного промта, потолок 48 KB на SKILL.md), `@путь` разворачивается в содержимое файлов (лимиты: 16 файлов, 48 KB на файл, 160 KB суммарно; пути не выходят за рабочую папку; секреты - `.env*`, `*.pem`, `*.key`, `*id_rsa*`, `secrets/` - не читаются). Недоверенное содержимое (навыки, роли, файлы) обёртывается блоками `UNTRUSTED` с системным пояснением "данные, а не инструкции". История чата хранит исходный текст с токенами. Меню показывает до 120 пунктов; при пустом запросе группы идут в порядке: навыки, master skills, workflow, агенты.

`/workflow:<id> <промт>` в direct-режиме запускает существующий workflow (`POST /api/workflow-runs`, `input.request` = остаток промта); ссылка на прогон показывается как при запуске из селектора workflow. `/master:` в запросе запуска workflow делает навык run-уровневым; `/agent:` отклоняется - агенты выбираются в узлах.

## Нативные команды рантаймов (синк)

Синк (`core/commandSync.ts`) создаёт нативные слэш-команды в обязательной рабочей папке - master-навыки и workflow доступны в отдельно запущенном рантайме без консоли:

| Рантайм | Каталог | Форма | Вызов |
|---|---|---|---|
| claude | `.claude/commands/master/<id>.md`, `.claude/commands/workflow/<id>.md` | команды | `/master:<id>`, `/workflow:<id>` (подпапка даёт двоеточие) |
| zcode | `.zcode/commands/master/<id>.md`, `.zcode/commands/workflow/<id>.md` | команды | `/master:<id>`, `/workflow:<id>` |
| cursor | `.cursor/commands/master-<id>.md`, `workflow-<id>.md` | команды | `/master-<id>`, `/workflow-<id>` |
| opencode | `.opencode/command/master-<id>.md`, `workflow-<id>.md` | команды | `/master-<id>`, `/workflow-<id>` |
| codex | `.codex/skills/master-<id>/SKILL.md`, `workflow-<id>/SKILL.md` | навыки | `/master-<id>`, `/workflow-<id>` |
| kimi | `.kimi-code/skills/master-<id>/SKILL.md`, `workflow-<id>/SKILL.md` | навыки | `/skill:master-<id>`, `/skill:workflow-<id>` |

Для каждого рантайма создаются общие команды `/master` и `/workflow` (аргумент `<id> <задача>`; без id команда выбирает подходящий навык по описаниям манифестов) и по команде на каждый workflow каталога и каждый internal-навык, включённый для рантайма (привязка `manifest.runtimes` + эффективный тоггл `master:`/`design:`). Командные файлы - frontmatter `description`/`argument-hint` и указание прочитать `SKILL.md` навыка или YAML workflow (`$ARGUMENTS` - задача пользователя). Codex и kimi командных каталогов не имеют - там те же команды доставляются навыками (`SKILL.md` с frontmatter `name`/`description`); kimi подставляет `$ARGUMENTS`, у codex задача - текст после вызова команды.

Управляемые файлы помечены маркером `<!-- generated by harness console -->` (у навыков - после frontmatter); синк перезаписывает и удаляет только их, чужие файлы и каталоги не изменяются. Каталоги команд и сгенерированные навыки - артефакты, в git не попадают (.gitignore).

Синк выполняется автоматически: переключение навыков (PATCH `/api/skills`), удаление навыка, сохранение workflow. Ручная регенерация и статус (план vs фактические файлы, `GET`/`POST /api/commands/sync`) - Настройки → Навыки → панель "Команды рантаймов". Нативный запуск workflow - упрощение: один исполнитель, узлы последовательно по `dependsOn`; полный цикл с контролами, рантаймами узлов и журналом выполняет консоль.

## Run-уровневые навыки workflow

Ведущие `/master:<id>` запроса запуска (`input.request`) парсит `POST /api/workflow-runs`: preflight проверяет существование и привязку к runtime-кандидатам выбранных узлов (severity по политике capabilities), навыки замораживаются в `resolution.skills` и передаются движку списком `input.masterSkills` - `collectSkills` объединяет их с навыками ролей узла.

## Уровни (вкладка "Навыки и скрипты" в пространстве рантайма)

| Саб-таб | Источник | Что там |
|---|---|---|
| Навыки | единый список источников, доступных этому рантайму | лейблы, бейджи рантаймов, override данного рантайма |
| Скрипты | агенты/скрипты рантаймов (`~/.config/opencode/agents/*.md`, проектные плагины `.opencode/plugins/*.ts`, `~/.codex/prompts`) | не-навыки: агенты, плагины, промпты |
| MCP | серверы реестра для этого рантайма | per-runtime overrides MCP ([mcp.md](mcp.md)) |

## Семантика тогглов

```
effective(навык, рантайм R) =
    runtimeOverrides[навык][R]   // тоггл в пространстве рантайма
    ?? defaults[навык]           // per-skill значение по умолчанию (страница "Навыки")
    ?? useGlobal                 // глобальный toggle "Использовать глобальные навыки"
```

- Глобальный toggle - база: включён → все глобальные навыки во всех рантаймах включены; выключен - отключены.
- Per-skill значение по умолчанию - действует для всех рантаймов.
- Override рантайма - самый сильный; снимается кнопкой "сброс".
- Переключение (default и runtime) выполняет хуки навыка для рантаймов, у которых изменился effective; порядок: запись файла состояния → хуки → обновление интерфейса.

## skills.sh: поиск

`bunx skills find <query>` (HTTP API skills.sh требует Vercel OIDC-токен - поэтому CLI основной). Вывод (не-TTY, ANSI-чистый) парсится `core/skillsFind.ts`:

```
owner/repo@skill-name  737.7K installs
└ https://skills.sh/owner/repo/skill-name
```

`id` для установки - `owner/repo@skill`; URL показывается ссылкой. Кеш поиска 60 с; HTTP-фолбэк дополняет результат при < 3 находок.

## skills.sh: установка и удаление

`bunx skills add <pkg> -y` (DISABLE_TELEMETRY=1, cwd=корень репо) кладёт навык в **`.agents/skills/<name>`**, делает симлинки в найденные каталоги агентов и пишет `skills-lock.json` (по записям lock-файла выставляется лейбл skills.sh). После установки выполняется hook install. Вывод стримится в UI по SSE (ANSI-чистка), ввод можно передать в stdin (роуты `install` / `install?jobId=` / `install/input`).

Перед установкой - модалка: описание + аудит безопасности и кнопки "Установить/Отмена". Цепочка описания (`core/skillsSh.ts`, кеш 5 мин): снапшот реестра skills.sh → og:description → страница репозитория GitHub → DeepWiki → iframe. Аудит - `/api/v1/skills/audit/...` (Gen Agent Trust Hub, Socket, Snyk, Runlayer, ZeroLeaks; без токена может быть пуст).

`bunx skills remove <name> -y` (чистит `.agents/skills/<name>`, lock-запись, симлинки агентов); перед удалением - hook remove; если CLI не справился - ручная зачистка тех же мест (`core/skillRemove.ts`). В UI - кнопка "удалить" с подтверждением.

## Создание навыка

Форма (название, краткое описание, подробности, примеры) → промпт-билдер `core/skills/create` → запуск в новой headless-сессии рантайма задачи "Создание навыка" (настройки или ★, см. [operations.md](operations.md)). Промпт требует использовать skill-creator-навык агента (если есть) и класть файлы в `.agents/skills/<slug>/SKILL.md`; сессия появляется в общем списке сессий ([sessions.md](sessions.md)). Внутренние навыки создаются в мастер-каталоге (`.agents/skills/master/skills/<id>/` с manifest.yaml).
