# Design: дизайн-слой консоли

Раздел "Дизайн" (`/design`) - рабочее место дизайн-контекста обязательной рабочей директории, организован внутренними вкладами: **Обзор** (pack, провайдеры, задачи, артефакты), **Токены** (DESIGN.md, front matter), **Гайд** (DESIGN.md, markdown-тело), **Бренд** (BRAND.md), **UIKit** (design/ui-kit.md), **Компоненты** (design/components.json), **Навыки** (группа design), **Инструменты** (design-пресеты MCP). Провайдеры дизайна - Claude Design, Open Design, Figma MCP; единый запуск дизайн-задач через любой источник исполнения (headless-рантайм, провайдер реестра, отдельно запущенная сессия). Синхронизация действует на уровне обязательной директории: всё живёт в файлах самой папки, рантайм, запущенный из неё, подхватывает контекст без дополнительной настройки. Тема самой консоли - отдельно, во вкладке "Настройки → Внешний вид" ([ui-kit.md](ui-kit.md)); порядок провайдеров дизайна - настройка "Настройки → Workflow → Design providers".

## Design pack обязательной директории

Пакет - четыре файла в рабочей директории (`core/design/workspace.ts`):

| Файл | Содержимое |
|---|---|
| `DESIGN.md` | Визуальные токены в формате [@google/design.md](https://github.com/google-labs-code/design.md): front matter (colors, rounded, typography, spacing, components) + markdown-гайд |
| `BRAND.md` | Бренд-паспорт (свободный markdown): имя и суть, аудитория, тон коммуникации, фирменные элементы. Смысловой слой - здесь, числовые значения - в DESIGN.md |
| `design/ui-kit.md` | Правила интерфейса web и mobile: стек, примитивы кита, запреты |
| `design/components.json` | Реестр компонентов: `{version, updated, web: [{name, path}], mobile: [{name, path}]}` |

Создание - кнопка "Создать из пресета": DESIGN.md копируется из пресета `themes/` консоли, BRAND.md создаётся по шаблону (скелет секций), ui-kit.md и components.json - по шаблонам, существующие файлы не перезаписываются. Первичное заполнение components.json - сканирование типовых каталогов (`src/components`, `components`, `src/uikit/components`, `src/uikit`, `apps/console/src/uikit/components`, `packages/ui/src`; mobile - каталоги с `mobile` в пути; компонент - PascalCase-файл или папка с `index.tsx`, имя = имя папки, лимит 200) или кнопка "Зарегистрировать кит" (`register-kit` - компоненты-папки кита, для кита вне типовых каталогов); дальше манифест ведут рантаймы через задачи.

## Редактор DESIGN.md

Панель "DESIGN.md - визуальные токены" во вкладке "Дизайн" (`components/design/DesignTokensEditor.tsx`) - форма поверх формата @google/design.md:

- пресеты `themes/` (5 тёмных + 5 светлых) загружаются как база формы, на диск пишут только по "Сохранить";
- свотчи 18 цветовых ролей по группам (примитив `ColorSwatch` в UIKit: системный color-picker под кнопкой + hex-поле), радиусы md/lg/xl - текстом;
- 5 слайдеров-мультипликаторов (насыщенность, светлота поверхностей, контраст текста, яркость акцентов, скруглённость) - чистые трансформы `lib/color.ts`; прямая правка роли сбрасывает слайдеры;
- предпросмотр двух видов: собранный файл (front matter пересобирается на клиенте `buildDesignFile`) и markdown-гайд;
- сохранение - `POST {action: "save-design"}`: валидация токенов, lint `@google/design.md/linter` (ошибки запрещают запись), атомарная запись; findings возвращаются и показываются в панели. Несохранённый черновик не перезаписывается перезагрузками статуса.

## Редактор гайда DESIGN.md

Вклад "Гайд" (`components/design/DesignGuideEditor.tsx`) - правка markdown-тела DESIGN.md без изменения front matter с токенами. Редактор - `MarkdownSectionsEditor` (`components/design/MarkdownSectionsEditor.tsx`): документ делится по заголовкам H2 на карточки (`lib/markdown-sections.ts`, разбор с учётом fenced-блоков; склейка воспроизводит документ посимвольно), каждая карточка и режим "Исходник" редактируются в `MarkdownEditor` (`uikit/MarkdownEditor.tsx`) - textarea поверх подсвеченной подложки (highlight.js, тема `.hljs-*` в globals.css на дизайн-токенах). Сохранение - `POST {action: "save-design-guide"}`: front matter остаётся без изменений, ошибки линта запись запрещают.

## Редактор BRAND.md

Панель "BRAND.md - бренд-паспорт" (`components/design/BrandEditor.tsx`): тот же `MarkdownSectionsEditor` - секционные карточки ("Имя и суть", "Аудитория", "Тон коммуникации", "Фирменные элементы"), режимы "Секции / Исходник / Предпросмотр". Файла нет - EmptyState с кнопками "Создать по шаблону" (`action: "brand-template"` + `save-brand`) и "Заполнить задачей" (префилл провайдера open-design в панель "Задача"). Сохранение - `POST {action: "save-brand"}`, атомарная запись; счётчик символов и индикатор несохранённых правок - в шапке панели.

## Редактор UIKit и менеджер Компонентов

Вклад "UIKit" (`components/design/UiKitEditor.tsx`) - тот же редакторный механизм для design/ui-kit.md: создание по шаблону (`action: "uikit-template"`), "Редактор/Предпросмотр" в `MarkdownEditor` с подсветкой, `save-uikit`. Файл описывает правила интерфейса web и mobile; его читают рантаймы (упомянут в managed-блоке) и провайдер-задачи.

Вклад "Компоненты" (`components/design/ComponentsManager.tsx`) - реестр design/components.json: списки web и mobile (имя + путь), добавление и удаление записей (каждая мутация сохраняется через `save-components`), кнопка "Пересканировать" (`scan-components` - первичное заполнение из типовых каталогов проекта) и кнопка "Зарегистрировать кит" (`register-kit` - компоненты-папки `<kit>/components/<Name>/index.tsx`, если каталог кита вне типовых WEB_DIRS). Дальше манифест ведут рантаймы через задачи дизайн-раннера.

## Синхронизация в рантаймы

Канал синхронизации - файлы рабочей папки (`core/design/sync.ts`). Кнопка "Синхронизировать в рантаймы" пишет managed-блок `<!-- harness-design:start|end -->`:

- в `CLAUDE.md` - Claude Code читает `@DESIGN.md` и `@BRAND.md` импорты нативно (полное содержимое обоих файлов);
- в `AGENTS.md` - OpenCode, Codex, ZCode, Kimi читают AGENTS.md: пути всех четырёх файлов, ключевые токены DESIGN.md инлайном и правило приоритетов (смысл - BRAND.md, значения токенов - DESIGN.md); @-импорты не гарантированы, поэтому файлы читаются из директории по указанию в блоке.

Блок описывает и дизайн-MCP. Управляет только содержимым блока - остальной текст файлов не меняется (утилиты `src/lib/managed-block.ts`). MCP-серверы попадают в рантаймы проектным `.mcp.json` - его пишет общий синк [mcp.md](mcp.md); здесь консоль только показывает статус.

## Провайдеры дизайна и единый запуск задач

Панель "Провайдеры дизайна" показывает готовность трёх провайдеров (`GET designTools`):

- **Claude Design** - встроенная команда `/design` рантайма claude (Claude Code ≥ 2.1.234, research preview); кнопка "Задача" запускает claude-сессию с брифом;
- **Open Design** - MCP включён в реестре + CLI `od` с поддержкой `--daemon-url` (проверка `detectToolCli`);
- **Figma MCP** - MCP включён в реестре (OAuth при первом вызове).

`POST /api/design/run {dir, prompt, target}` (`core/design/run.ts`) - одна точка входа:

| target | Исполнение |
|---|---|
| `{kind: "runtime", id}` | Headless-рантайм (claude, opencode, codex, kimi, zcode): `launchPromptRun` с cwd = папка, промт дополнен преамбулой пакета (DESIGN.md, BRAND.md, ui-kit, components); лог в `.agents/console/runs/` |
| `{kind: "provider", id}` | Агентный цикл в процессе консоли (`runAgentLoop`): в системном промте - токены, правила кита, содержимое BRAND.md (лимит 6000 симв.) и компоненты; инструменты - встроенные + MCP open-design/figma; таймаут 600 с |
| `{kind: "session", runtime, sessionId}` | Headless-resume отдельно запущенной сессии (`adapter.replyCommand`, cwd = папка сессии); таймаут 300 с |

Панель "Задача" содержит 4 шаблона контуров (кнопки подставляют исполнителя и промт) - см. раздел "Дизайн-контуры".

## Навыки дизайна (группа design)

Группа design - второй internal-каталог навыков по механике master: `.agents/skills/design/skills/<id>/{manifest.yaml, SKILL.md}`, корень - `designSkillRoot` из `.agents/runtime/config.json`. Лейбл `design` в едином реестре навыков (фильтр во вкладке "Навыки"), itemId `design:<id>`, симлинки и хуки манифеста - как у master (`core/skillHooks.ts`, префикс `design:`); `/skill:<id>`, preflight и workflow-движок подхватывают группу через общий `loadInternalSkills` (группа в поле `group` записи).

Панель "Навыки" вкладки "Дизайн" (`components/design/DesignSkillsPanel.tsx`): список design-навыков с тогглом уровня default (PATCH /api/skills) и кнопкой "В Задачу" (упоминание навыка в промте). Члены группы установлены своими утилитами и перенесены в группу: **taste-skill** (набор из 12: brandkit, design-taste-frontend, gpt-taste, high-end-visual-design, image-to-code, imagegen-frontend-*, industrial-brutalist-ui, minimalist-ui, redesign-existing-projects, stitch-design-taste), **impeccable** (impeccable.style: дизайн-словарь, ~61 анти-паттерн AI-UI), **ui-ux-pro-max** (+banner-design, brand, design, design-system, slides, ui-styling; CSV-каталоги стилей/палитр/шрифтов, BM25-поиск, генератор дизайн-систем), **stitch** - официальный навык Google Stitch (CLI `@google/stitch`, `stitch agent-skills add`; плейбуки: Canvas и экраны, синхронизация DESIGN.md со Stitch-проектом, локальный UI-ревью по DESIGN.md). Смежный публичный навык - `frontend-design` (остаётся в skills.sh). Манифесты группы: runtimes [claude, codex, cursor, kimi, zcode, opencode, provider], теги design/ui/ux/brand.

## Дизайн-контуры (workflows)

| Контур | Исполнитель | Инструменты | Результат |
|---|---|---|---|
| Бриф → идентичность | claude (кнопка провайдера "Claude Design") | команда `/design` или собственная разработка рантайма | варианты → DESIGN.md (токены) + BRAND.md (смысл) |
| Макет Figma → компоненты | провайдер или рантайм | figma MCP | компоненты web/mobile в ките + запись в components.json |
| Аудит интерфейса | рантайм | playwright / chrome-devtools MCP (скриншоты), token-сверка | находки с приоритетами, критичные правки сразу |
| Артефакты → бренд-паспорт | провайдер | open-design MCP (list_projects, get_artifact) | заполненный BRAND.md, палитра сверена с DESIGN.md |

## Инструменты дизайна

Панель "Инструменты дизайна" показывает design-пресеты каталога MCP (поле `category: "design"` в `MCP_PRESETS`, `core/plugins.ts`) со статусом и кнопками установки/включения через `POST/PATCH /api/mcp`: **figma**, **open-design**, **playwright**, **webmcp**, **excalidraw** (официальный удалённый `https://mcp.excalidraw.com`, без ключей - вайрфреймы), **stitch** (официальный stdio `stitch mcp start`, CLI @google/stitch: Canvas, DESIGN.md sync, UI-ревью; нужна авторизация `stitch login` или STITCH_API_KEY), **google-design** (`https://design.googleapis.com/mcp`, цветовые схемы, бренд-цвета из изображений, шрифты Google Fonts и Material Symbols; ключ Gemini не обязателен, при необходимости - заголовок `x-goog-api-key`). Полное управление транспортами - "Настройки → MCP". Прочие инструменты дизайн-задач: навык `frontend-design` (anthropics/skills), скриншот-серверы playwright/chrome-devtools (плагин), артефакты open-design. Направления без подтверждённых пакетов (в консоль не включены): Iconify MCP, font-mcp.

## Сессии OpenCode: привязка к директории

OpenCode хранит сессии в SQLite `~/.local/share/opencode/opencode.db`; таблица `session` содержит колонку `directory`. Чтение (`core/sessions/opencode.ts`) идёт через системный `sqlite3 -readonly -json` (WAL-база читается при работающем OpenCode). Список - фильтр по рабочим папкам, детали - best-effort превью из таблицы `message`. Нет БД или sqlite3 - пустой список. Ответ в сессию - `opencode run -s <id>` ([sessions.md](sessions.md)).

## API

| Роут | Назначение |
|---|---|
| `GET /api/design/workspace?dir=` | Статус пакета (DESIGN.md с токенами и lint, BRAND.md, ui-kit, components), managed-блоков, дизайн-MCP, активные провайдеры, design router, готовность designTools |
| `POST /api/design/workspace` | Действия: `init` (пакет из пресета + шаблоны BRAND/ui-kit/components), `save-design` (токены + lint findings), `save-design-guide` (markdown-тело DESIGN.md, front matter без изменений), `save-brand`, `brand-template`, `save-uikit`, `uikit-template`, `scan-components`, `register-kit`, `save-components`, `sync`, `desync` |
| `POST /api/design/run` | Запуск дизайн-задачи (runtime / provider / session) |
| `POST /api/design/artifacts` | Артефакты open-design для папки |
| `GET /api/mcp/catalog` | Каталог MCP-пресетов (design-категория для панели "Инструменты дизайна") |

UI - `apps/console/src/app/design/page.tsx`, `components/design/DesignWorkspace.tsx`, `DesignTokensEditor.tsx`, `DesignGuideEditor.tsx`, `MarkdownSectionsEditor.tsx`, `BrandEditor.tsx`.

## Ограничения и развитие

- Генерация компонентов и заполнение BRAND.md - задачи рантайма/провайдера через раннер; консоль файлы кита не пишет.
- Превью web-страниц в консоли нет; проверка интерфейса - рантаймом (скриншоты через playwright/chrome-devtools MCP).
- Итерация 2 - собственный MCP-сервер консоли `harness-design` (stdio, cwd = рабочая папка): `get_design_pack`, `get_uikit`, `list_components`, `get_brand` для любого рантайма без правки CLAUDE.md/AGENTS.md.
