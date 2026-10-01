# AGENTS.md - канонические инструкции репозитория

Этот файл - `canonicalInstructions` из `.agents/runtime/config.json`. Он обязателен для каждого рантайма (Claude Code, Codex, ZCode, Cursor, Kimi Code, OpenCode) и связывает переменные из `.agents/runtime/` с контекстами, в которых они применяются. Значения, указанные здесь, - рабочие значения по умолчанию; если в конфиге твоего рантайма значение отличается - действует конфиг.

Два файла - источник всех настроек:

- `.agents/runtime/config.json` - общие: guard, verification, limits, profiles, temp;
- `.agents/runtime/<vendor>/config.json` - твоего рантайма: адаптер, модели, права.

## 1. Идентификация рантайма

В начале сессии определи свой рантайм и выставь переменные окружения - они используются guard'ом и всеми правилами ниже:

| Рантайм | Адаптер (файл хуков) | Хуки | `AGENT_RUNTIME` / `AGENT_RUNTIME_CONFIG` |
|---|---|---|---|
| Claude Code | `.claude/settings.json` (PreToolUse) | native | `claude` · `.agents/runtime/claude/config.json` |
| Codex CLI | `.codex/hooks.json` (PreToolUse; загрузка после trust через `/hooks`) | native | `codex` · `.agents/runtime/codex/config.json` |
| ZCode | `.zcode/config.json` (`hooks.events.PreToolUse`) | native | `zcode` · `.agents/runtime/zcode/config.json` |
| Cursor | `.cursor/hooks.json` (`preToolUse`, fail-open) | native | `cursor` · `.agents/runtime/cursor/config.json` |
| Kimi Code | `.kimi/config.toml` → зеркало в `~/.kimi-code/config.toml` | user-mirror | `kimi` · `.agents/runtime/kimi/config.json` |
| OpenCode | `opencode.json` + `.opencode/plugins/agentos-guard.ts` | native (плагин) | `opencode` · `.agents/runtime/opencode/config.json` |

Правила по рантайму:

- **Kimi**: проектных хуков нет. На первом запуске попроси пользователя скопировать `[[hooks]]`-блок из `.kimi/config.toml` в `~/.kimi-code/config.toml`   (хуки Kimi запускаются с cwd = каталог проекта, относительные пути работают). До зеркала политика соблюдается поведенчески - прогоняй сомнительные вызовы через guard вручную (см. §3).
- **Codex**: репозитарные хуки грузятся только после доверия слою `.codex/` (команда `/hooks` в Codex). Проверь это на первом запуске.
- **Cursor**: хук настроен с `failClosed: false` - упавший хук пропускает вызов. Guard здесь - слой поверх одобрений IDE, а не единственная защита.

## 2. Вывод основных настроек в терминал - TEMP (временно для теста)

> Временное правило для проверки, что переменные резолвятся правильно.
> Удалить этот раздел и режим `settings` после окончания теста.

В начале каждой сессии выведи в терминал блок основных настроек и покажи его пользователю:

```bash
AGENT_RUNTIME=<id> AGENT_RUNTIME_CONFIG=.agents/runtime/<id>/config.json node .agents/runtime/guard.mjs settings
```

В выводе сверяются: адаптер и hooksSupport твоего рантайма, guard-команда, активный профиль (`AGENT_PROFILE`, по умолчанию `default`), tier→модель, лимиты, права и verification-команды. Если в выводе "NOT verified" у модели или адаптер не соответствует таблице §1 - сообщи пользователю до начала работы.

## 3. Guard: проверка вызовов до выполнения

Guard - единый движок политики: `.agents/runtime/guard.mjs` (поле `guard` в `.agents/runtime/config.json`). Все шесть адаптеров из §1 запускают его как PreToolUse-хук с переменными `AGENT_RUNTIME` и `AGENT_RUNTIME_CONFIG`.

- Контракт: stdin `{"tool_name":"Bash","tool_input":{"command":"…"}}`; **exit 0** - разрешено (warn-правила печатаются в stderr), **exit 2** - блок.
- При блоке stderr содержит id правила, причину и строку `Instead: …` - следуй ей, не обходи блок.
- Нативный хук - автоматический слой. Он не отменяет ручную проверку: перед любой сомнительной shell-командой или записью прогони payload через guard сам:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"<команда>"}}' | node .agents/runtime/guard.mjs
```

- Самопроверка guard на каждом рантайме - `verifyCommand` из твоего конфига (ожидается exit 2 и причина в stderr).
- Ключевое из политики: рекурсивное удаление (`rm -r`) разрешено только под `.agents/.tmp/`, `/tmp`, `.nx/`, `node_modules/`; worktree удаляется `bun run worktree:remove <slug>`, не `rm`; push без `--force-with-lease` запрещён; секреты (`.env*`, `*.pem`, `id_rsa`, `secrets/`) не читаются и не пишутся; `.git/`, `node_modules/`, lock-файлы не редактируются; правки `.agents/roles|skills|runtime|agents` - warn: сначала предложение пользователю; правка самого guard - блок: только через пользователя.

## 4. Модели: tier → контекст

Бери модели из `models` **своего** конфига. Контексты применения:

| Tier | Когда использовать |
|---|---|
| `fast` | быстрый поиск, чтение, мелкие точечные правки, рутинные проверки |
| `standard` | обычная работа по умолчанию (`profiles.default.defaultModel` = `standard`) |
| `strong` | архитектура, глубокая отладка первопричин, рефакторинг, финальное ревью |
| `subagents` | модель для спавна субагентов (роль `subagents` в `models`) |

Текущие значения по рантаймам (из конфигов; актуальность - §2):

| Tier | claude | codex | cursor | kimi | zcode | opencode |
|---|---|---|---|---|---|---|
| fast | claude-sonnet-5-5 | GPT 6 Luna | Composer 2.5 (Fast) | kimi-k2.7-code-highspeed | GLM 5.3 Flash | GLM 5.3 Flash |
| standard | claude-opus-5-5 | GPT 6 Sol | Composer 2.5 | kimi-k3 | GLM 5.3 Flash | GLM 5.3 |
| strong | claude-fable-5-1 | GPT 6 Astra | Claude Fable 5.1 | kimi-k3 | GLM 5.3 | Claude Opus 5 |
| subagents | claude-sonnet-5-5 | GPT 6 Sol | Claude Sonnet 5.5 | kimi-k2.7-code | GLM 5.3 Flash | GLM 5.3 Flash |

- `thinkingLevel` у tier - целевой уровень рассуждений (`low` / `medium` / `high` / `max`); для zcode `standard`/`strong`/`subagents` это `max`.
- Модель с `verified: false` (все, кроме claude) - подтверди маппинг у пользователя на первом запуске в этом рантайме, затем впиши подтверждённое значение обратно в конфиг.
- OpenCode - bring-your-own-provider: фактические модели определяются провайдерами пользователя, значения в конфиге - предполагаемое отображение.

## 5. Лимиты: переменная → контекст → значение

Лимиты берутся из `limits` в `.agents/runtime/config.json` и переопределяются профилем (§6). Значения ниже - профиля `default`.

| Переменная | Значение | Контекст применения |
|---|---|---|
| `repairAttempts` | 3 | максимум попыток починки (тест/сборка/линт) прежде чем эскалировать пользователю |
| `maxParallelAgents` | 4 | потолок одновременно работающих субагентов |
| `wipLimit` | 4 | максимум задач в работе одновременно; новая задача - только после закрытия слота |
| `decisionTreeDepth` | 4 | глубина ветвления при выборе подхода; дальше - решай и обосновывай |
| `researchPasses` | 2 | проходов исследования/поиска перед синтезом |
| `architecturePasses` | 3 → 2 | итераций архитектурного проектирования (`default`: 2) |
| `reviewPasses` | 2 | проходов ревью собственного изменения |
| `rootCauseDepth` | 5 | глубина вопросов "почему" при поиске первопричины |
| `requiredReadingBytes` | 118000 | прочитать ≥ этого объёма контекста до первых правок |
| `referenceTopics` | 3 | минимум тем/источников для сверки в спорных вопросах |

Превышение лимита - не ошибка, а сигнал остановиться и эскалировать либо упростить план.

## 6. Профили

`profiles` из `.agents/runtime/config.json` переопределяют `limits` и задают `defaultModel`. Активный профиль - переменная `AGENT_PROFILE` (по умолчанию `default`); выбирай по задаче и назови его в §2-выводе:

| Профиль | defaultModel | Отличия лимитов |
|---|---|---|
| `fast` | fast | repairAttempts 2, rootCauseDepth 3, параллелизм/WIP 2, проходы 1, decisionTreeDepth 2 |
| `default` | standard | базовые значения §5 |
| `deep` | strong | repairAttempts 5, rootCauseDepth 7, параллелизм/WIP 6, проходы 3, decisionTreeDepth 6 |

## 7. Верификация

Команды - из `verification` в `.agents/runtime/config.json`; используй их как есть:

| Контекст | Команда |
|---|---|
| после каждого изменения | `bun run tooling/scripts/src/verify.ts verify-fast` |
| перед слиянием/интеграцией | `bun run tooling/scripts/src/verify.ts verify-integration` |
| перед релизом / работа с секретами | `bun run tooling/scripts/src/verify.ts verify-security` |
| приёмочное тестирование поставки | `bun run tooling/scripts/src/verify.ts verify-e2e` |

Если команда недоступна (tooling отсутствует в этом срезе репозитория) - не молчи: сообщи пользователю, что проверить не удалось, и что проверено вручную.

## 8. Права

Из `permissions` твоего конфига:

- `git.commit: true` - коммить разрешено; `git.push: false` и `git.forcePush: false` - **никогда не пушить и не форсить**, в любом режиме.
- Поставленная задача выполнена и проверки §7 пройдены - сделай коммит в той же серии изменений. Сообщение - по Conventional Commits: `<type>(<scope>): <описание>`. Тип - из набора `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`; область - затронутая часть репозитория; описание - деловой стиль §12, как в истории репозитория. Проверки не пройдены - коммита нет: сначала починка или отчёт пользователю.
- `shell: "policy-guarded"` - shell всегда под политикой §3.
- `filesystem: read/write true` - но чтение/запись идут через собственные разрешения хоста (prompts/sandbox); у guard'а поверх них - свои правила.
- MCP-серверы - только из списка `permissions.mcp` твоего конфига.
- Структурные изменения (`.agents/roles|skills|runtime|agents`, правка guard) - всегда с явного одобрения пользователя; guard предупредит или заблокирует.

## 9. Пути и временные файлы

- `temp` = `.agents/.tmp` - все временные артефакты только там.
- Разрешённые зоны рекурсивного удаления - только `.agents/.tmp`, `/tmp`, `.nx`, `node_modules`; защищённые пути - `.git/`, `node_modules/`, lock-файлы, секреты (см. §3).
- Worktree под `.agents/.worktrees/` - удаление только через `bun run worktree:remove <slug>`.

## 10. Системные зависимости и установка

Установка системных инструментов - `bun run setup` из корня; если bun ещё нет - `bash tooling/scripts/setup.sh` (скрипт самодостаточен и работает на "пустой" системе). Флоу: статус системы (ОС, arch, найденные инструменты и версии) → выбор пакетного менеджера глобальных npm-пакетов (Bun: `bun add -g`/`bunx` или NPM: `npm install -g`/`npx`; сохраняется в `.agents/console/package-manager.json`, его читает и консоль) → список того, что будет установлено → подтверждение пользователя → установка (`--check` - только статус, `--yes` - без вопросов). Внешние инсталлеры (Homebrew, bun, NodeSource, uv, rtk) не исполняются напрямую из сети: скрипт скачивает их curl'ом в `.agents/.tmp/setup/` и запускает как локальные файлы, содержимое которых можно просмотреть до выполнения.

Инструменты скрипта:

| Инструмент | Статус | Назначение |
|---|---|---|
| `bun` (+`bunx`) | обязательный | менеджер пакетов, раннер скриптов, `bunx skills …` |
| `node` ≥ 22 | обязательный | guard-хуки рантаймов, headless-запуск ZCode, база для openwiki |
| `uv` | опциональный | питоньи инструменты (serena/graphify/headroom) |
| `openwiki` | опциональный | вкладка "Память": сборка вики и визуализатор |
| `serena` | опциональный | семантическая навигация по коду (LSP, MCP) |
| `qmd` | опциональный | локальный поиск по markdown (MCP) |
| `codegraph` | опциональный | knowledge graph кода (MCP + per-runtime) |
| `graphify` | опциональный | граф знаний кода/доков (skill/hooks, вкладка "Память") |
| `rtk` | опциональный | сжатие вывода shell-команд (хуки рантаймов) |
| `headroom` | опциональный | сжатие контекста перед LLM (прокси/MCP) |

Способы установки: macOS - Homebrew (нет brew - скрипт предложит поставить и его), Linux - официальный инсталлер bun и NodeSource для node. Системные утилиты (`ps`, `sh`, `which`, `open`, `git`) только проверяются. **Рантаймы агентов (Claude Code, Codex, ZCode, Cursor, Kimi, OpenCode) в установку не входят** - их пользователь ставит самостоятельно. Per-runtime настройку опциональных инструментов (`graphify install` / `rtk init` / `headroom wrap`) делает консоль: "Настройки → Инструменты".

### Инструменты экономии контекста и диспетчер tool.sh

Инструменты оформлены **плагинами** (`apps/console/src/core/tools/<id>.ts`, агрегатор - `core/tools.ts`; как написать новый - `docs/tools-dev.md`). Реестр и жизненный цикл - раздел "Настройки → Инструменты" консоли и `docs/tools.md`: установка per-runtime (глобально или в проект), вкл-выкл, переустановка, удаление, **диагностика** (кнопка проверяет CLI, зависимости, интеграции и дашборд; при поломке - промпт headless-исправления через `/api/prompts/run`), **автозапуск** сервисов (Serena/Headroom - тоггл в карточке) и дашборды (точка-индикатор: зелёная - работает, жёлтая - инстанс запущен, порт не принимает соединения, красная - не запущен). Агенту ничего устанавливать не нужно - только пользоваться.

**Общее правило:** один раз в начале сессии выполни `bash tooling/scripts/tool.sh status`. CLI-инструменты вызывай только через диспетчер: `bash tooling/scripts/tool.sh <id> <args…>`. Код выхода `3` со строкой `TOOL_UNAVAILABLE <id>: …` в stderr - инструмент не установлен или выключен: работай обычным способом (grep/чтение файлов) и ничего не устанавливай без запроса пользователя. MCP-инструменты рантайма (префикс `mcp__serena__`) используй, если `status` показал `serena on`.

| Инструмент | Когда предпочесть обычному чтению | Как вызывать |
|---|---|---|
| serena | поиск/чтение/правка по символам вместо Read файла целиком | MCP `mcp__serena__find_symbol`, `get_symbols_overview`, `replace_symbol_body` |
| codegraph | обзор незнакомого кода: символ + call paths одним вызовом | `tool.sh codegraph explore "<символ>"`, `callers` / `callees` / `impact` |
| graphify | "где делается X" по коду и докам: подграф вместо grep | `tool.sh graphify query "<вопрос>"` |
| qmd | поиск по markdown-докам и заметкам | `tool.sh qmd query "<запрос>"` (CLI) или MCP `qmd query/get` |
| rtk | шумные команды: git, тесты, lint | префикс: `tool.sh rtk git diff`, `tool.sh rtk bun test` |
| headroom | прозрачен: прокси держит консоль (autostart) - вызывать не нужно | memory-инструменты при наличии |

Развёрнутые правила:

- **Serena**: для навигации по коду предпочитай `mcp__serena__find_symbol`, `find_referencing_symbols`, `get_symbols_overview` чтению файлов целиком; правки - `replace_symbol_body` / `insert_after_symbol` вместо Read+Edit всего файла.
- **CodeGraph**: перед цепочкой grep/Read по незнакомому модулю - один вызов `codegraph_explore` (или `tool.sh codegraph explore "<имя>"`): вернёт исходник + call paths + blast radius одним payload, экономит цепочку вызовов.
- **Graphify**: вопросы про архитектуру/поток ("где обрабатывается X") - `tool.sh graphify query "<вопрос>"`; после крупных правок граф обновляет консоль или `graphify update .`.
- **qmd**: "что в доках написано про Y" - `tool.sh qmd query "Y"` вместо чтения `docs/` целиком.
- **RTK**: если хук рантайма не активен, префиксуй шумные команды (`tool.sh rtk git status`, `tool.sh rtk npm run lint`) - вывод сожмётся до попадания в контекст; полный вывод - `rtk recall <hash>`.
- **Headroom**: сжатие происходит в локальном прокси автоматически; ничего дополнительно вызывать не нужно.

Инициализация и обновление: Serena, CodeGraph и Graphify проиндексируйте в проекте после установки - кнопка **"Инициализировать"** в карточке (скрывается, когда инициализация выполнена): `serena project index`, `codegraph init`, `graphify extract . --code-only` (локальный AST без LLM-ключа; полный режим с доками требует API-ключ). То же выполняется при установке из консоли и в setup.sh. OpenWiki собирается **на русском**: `openwiki --language ru --init|--update "Веди вики на русском языке."`.

Дальше индексы обновляются автоматически: husky pre-commit (скрипт `tooling/scripts/pre-commit-tools.sh` запускает `codegraph sync -q`, `graphify update . --code-only`, `serena project index`- только для установленных и уже инициализированных; best-effort, коммит не блокирует). Обход: `SKIP_TOOLS_UPDATE=1 git commit …`. graphify-out/ и .codegraph/ - в .gitignore; .serena/ коммитьте по желанию (project.yml + memories).

Правило поддержки: **если изменение начинает использовать новый внешний инструмент или библиотеку, отсутствующую в npm-зависимостях воркспейса (CLI, бинарник, глобальный npm-пакет, системная утилита вне базового набора ОС), - в той же серии коммитов оформи его плагином** (`core/tools/<id>.ts` + строка в реестре `core/tools.ts`; гайд - `docs/tools-dev.md`) **и обнови** `tooling/scripts/tool.sh` (диспетчер агентов), `tooling/scripts/setup.sh` (статус и установка) и `docs/tools.md`; таблицы этого раздела держи синхронными.

## 11. Документация (`docs/`)

`docs/` - архитектурная и фичевая документация репозитория (индекс и карта - `docs/README.md`; пользовательский гид - `apps/console/README.md`). Документация **обязана поддерживаться в актуальном состоянии**: расхождение с кодом - баг; заметил - исправь или зафиксируй TODO и сообщи пользователю.

Когда обновлять (в той же серии коммитов, что и фича):

| Изменение | Документ |
|---|---|
| новый/изменённый рантайм: адаптер, сигналы активности, статусы, диагностика | `docs/runtimes.md` |
| источники/формат сессий, resume-команды, awaiting-эвристика | `docs/sessions.md`, `docs/runtimes.md` |
| MCP-синк: таргеты, форматы, managed-семантика, overrides, пресеты | `docs/mcp.md` |
| плагины, формат marketplace-манифеста, builtin-каталог | `docs/plugins.md` |
| навыки: уровни, семантика тогглов, флоу skills.sh (find/add/remove/create) | `docs/skills.md` |
| новые/изменённые API-роуты, схема `state.json`, кеши/производительность, безопасность | `docs/architecture.md` |
| процессы, промпты/"Исправить", настройки задач, рабочие папки, guard-совместимость | `docs/operations.md` |
| запуск/навигация консоли (как пользоваться) | `apps/console/README.md`, `docs/README.md` |

Правила: диаграммы - ASCII; язык - русский (деловой стиль - §12); структура документов меняется - обнови индекс `docs/README.md` и таблицу выше.

## 12. Язык текстов: деловой стиль (ориентир - ASD-STE100)

Правило действует во всём, что ты пишешь или правишь: комментарии в коде, названия и описания тестов, сообщения коммитов, документация (`docs/`, `apps/console/README.md`), пользовательские тексты интерфейса (статусы, диагностика, подсказки) и ответы пользователю в чате.

- Описывай наблюдаемое состояние буквально
- Не используй разговорные и жаргонные обороты состояний
- Один термин - одно значение и одна формулировка
- Короткие утвердительные предложения, действительный залог, без идиом, образных выражений и эмоциональной окраски. Ориентир - ASD-STE100 (Simplified Technical English): ограниченный словарь, одно слово - одно значение; для русского текста - нейтральный деловой стиль.

### Формат ответов пользователю

Правила задают структуру ответов в чате; деловой стиль выше задаёт тон.

- Первая строка ответа - результат или следующее действие, не контекст и не описание процесса.
- Многошаговая работа - нумерованные шаги, один шаг за раз; короткий завершённый путь лучше полного брошенного.
- Сообщение о ходе работы фиксирует состояние: что сделано, что осталось (например, "шаг 3 из 5 выполнен").
- Оценки - в числах: минуты, число шагов, количество файлов; не "немного" и "скоро".
- Сделанное называется конкретно: "вход по одноразовой ссылке работает", а не "авторизация улучшена".
- Ошибка излагается сухо: что произошло и что сделано в ответ.
- Видимый список - не больше 5 пунктов; больше - группируй или сокращай. Это ограничение подачи: полнота анализа не сокращается.
- Побочная находка - одна строка; углубление только по запросу пользователя.
- В конце сообщения: что сделано; если нужно действие пользователя - ровно один следующий шаг.
- Без преамбул ("сейчас рассмотрю"), пересказа задачи и вежливых концовок ("надеюсь, это поможет").

Исключения: явный запрос объяснения - полное изложение с заголовками; деструктивные действия - всегда с подтверждением; отладочный тупик после трёх попыток - назови неверное допущение и задай один диагностический вопрос; конфликт правила с задачей или правилами хоста - задача и хост важнее формы.

### Символы и переносы строк

Правила действуют во всех текстовых файлах репозитория: код, конфиги, документация, интерфейсные тексты, сообщения коммитов.

- В Markdown-файлах предложение не разрывается переносом строки: абзац и пункт списка пишутся одной строкой. Разметка (заголовки, таблицы, блоки кода, frontmatter) остаётся без изменений.
- Кавычки: только прямые ". Типографские кавычки-ёлочки запрещены, при обнаружении заменяются на ".
- Тире: длинное тире запрещено, используется дефис "-".

<!-- rtk-instructions v2 -->
# RTK

Prefix every shell command with `rtk`: `rtk git status`, `rtk cargo test`, `rtk npm run build`, `rtk ls src/`. Keep the prefix inside chains: `rtk git add . && rtk git commit -m "msg"`. Commands RTK has no filter for run as-is, so the prefix is always safe.

# Command output

Command output here is condensed to save tokens, keeping every signal and dropping costly noise. Treat it as the complete result: run commands normally, and batch related commands into one call to avoid extra turns. Truncated results state their recovery path in their own output. Re-run a command as `rtk proxy <cmd>` only when its result is unusable: empty when output was clearly expected, contradicting its exit code, or garbled.

## About RTK

RTK (Rust Token Killer) is a CLI proxy that filters command output to save tokens; behavior and exit code are unchanged.

- `rtk gain` / `rtk gain --history` - token savings, overall and per command.
- `rtk proxy <cmd>` - run a command unfiltered, still tracked.
- `RTK_DISABLED=1 <cmd>` - skip RTK for one command.
- `rtk discover` - find past commands RTK could have condensed.
<!-- /rtk-instructions -->

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call - the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely - indexing is the user's decision.
<!-- CODEGRAPH_END -->

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
