/**
 * Модель интерактивной карты архитектуры harness (вкладка "Архитектура").
 * Данные статические; источники - docs/architecture.md, .guardrails/README.md,
 * docs/workflows.md, docs/runtimes.md. Изменение архитектуры - правка здесь
 * и в профильных документах одной серией.
 */

export type ArchLayerId =
  | "client"
  | "console"
  | "runtime"
  | "workflow"
  | "guard"
  | "state"
  | "tools"
  | "provider"
  | "folders";

export interface ArchLayer {
  id: ArchLayerId;
  title: string;
  /** Цвет слоя - токен DESIGN.md (смысловые акценты и swatch-пятёрка). */
  color: string;
}

export interface ArchNode {
  id: string;
  layer: ArchLayerId;
  title: string;
  subtitle: string;
  description: string;
  files: string[];
  /** Позиция на канве, px (ширина узла - 210, задаётся компонентом). */
  x: number;
  y: number;
}

export type ArchSide = "top" | "bottom" | "left" | "right";

export interface ArchEdgeSpec {
  from: string;
  to: string;
  fromSide: ArchSide;
  toSide: ArchSide;
  label: string;
}

export interface ArchFlow {
  id: number;
  title: string;
  description: string;
}

export const ARCH_LAYERS: ArchLayer[] = [
  { id: "client", title: "Пользователь", color: "#a9adcd" },
  { id: "console", title: "Консоль", color: "#50fa7b" },
  { id: "runtime", title: "Рантаймы", color: "#bd93f9" },
  { id: "workflow", title: "Workflow", color: "#ff79c6" },
  { id: "guard", title: "Guardrails", color: "#ff5555" },
  { id: "state", title: "Состояние", color: "#f1fa8c" },
  { id: "tools", title: "Инструменты", color: "#8be9fd" },
  { id: "provider", title: "Провайдеры", color: "#ffb86c" },
  { id: "folders", title: "Рабочие папки", color: "#6272a4" },
];

export const ARCH_NODES: ArchNode[] = [
  {
    id: "user",
    layer: "client",
    title: "Пользователь",
    subtitle: "браузер",
    description:
      "Работает с консолью в браузере: страницы отдаются как RSC, данные - JSON API, живые обновления - SSE (workflow, установки, дашборды).",
    files: [],
    x: 480,
    y: 0,
  },
  {
    id: "console-ui",
    layer: "console",
    title: "Страницы и компоненты",
    subtitle: "App Router, React 19, zustand",
    description:
      "Разделы консоли: Агент, Дизайн, Рантаймы, Знание, Мониторинг, Архитектура, Настройки. Клиентское состояние - zustand-стор с persist для UI-настроек; данные вкладок кешируются с TTL.",
    files: ["apps/console/src/app/**", "apps/console/src/store/console.ts", "apps/console/src/uikit/**"],
    x: 170,
    y: 130,
  },
  {
    id: "console-api",
    layer: "console",
    title: "API-роуты",
    subtitle: "src/app/api/**, микрокеш",
    description:
      "Реестр роутов всех разделов - рантаймы, MCP, навыки, плагины и моды, сессии и direct-чаты, дизайн, git, память, мониторинг, статистика, оптимизация, цены, обновления, инструменты; полный перечень - в Реестре API docs/architecture.md. Дашборд кешируется (TTL 5 с + дедуп параллельных пересчётов), любая мутация инвалидирует кеш.",
    files: ["apps/console/src/app/api/**", "apps/console/src/core/cache.ts"],
    x: 440,
    y: 130,
  },
  {
    id: "console-lib",
    layer: "console",
    title: "Хелперы",
    subtitle: "src/lib",
    description:
      "Системные помощники: сигналы ФС и mtime, ps-сканер процессов (один снапшот на цикл проб), парсер TOML, форматирование.",
    files: ["apps/console/src/lib/*"],
    x: 730,
    y: 130,
  },
  {
    id: "console-core",
    layer: "console",
    title: "Ядро",
    subtitle: "src/core: состояние и домены",
    description:
      "Доменные модули: registry, state, mcp/sync, mcp/client, agentTools, agentLoop, processes, skills, skillsSh, plugins, installJobs, prompts, sessions, memory, providers. Инвариант мутаций: сначала файл (атомарно), потом ответ клиенту, потом клиентский стор.",
    files: ["apps/console/src/core/*"],
    x: 440,
    y: 270,
  },
  {
    id: "console-adapters",
    layer: "console",
    title: "Адаптеры рантаймов",
    subtitle: "src/runtimes/<id>.ts × 7",
    description:
      "Единый интерфейс к семи CLI: сессии и форматы транскриптов, сигналы активности, resume-команды, диагностика. Консоль только читает конфиги рантаймов - источник правды о них.",
    files: ["apps/console/src/runtimes/*.ts", "docs/runtimes.md"],
    x: 100,
    y: 270,
  },
  {
    id: "runtimes",
    layer: "runtime",
    title: "Рантаймы агентов (7)",
    subtitle: "claude, codex, zcode, cursor, kimi, opencode, antigravity",
    description:
      "CLI-агенты в рабочих папках: headless-запросы, сессии, PreToolUse-хуки, навыки и MCP-конфиги. Консоль управляет ими через адаптеры; workflow использует их как исполнителей шагов. Каждый рантайм приносит собственные guard-хуки.",
    files: [".agents/runtime/<vendor>/config.json", "docs/runtimes.md"],
    x: 40,
    y: 430,
  },
  {
    id: "workflow",
    layer: "workflow",
    title: "Workflow-движок",
    subtitle: "LangGraph.js + отдельный Bun worker",
    description:
      "Worker читает команды из SQLite, держит lease, пишет чекпоинты - прогон переживает закрытие браузера. Шаг: inputControl → execution → outputControl; failover - упорядоченный список кандидатов (CLI-рантаймы и provider:<id>). Run неизменяем: на старте сохраняется snapshot YAML, ролей, моделей и хэшей конфигов. Спринты исполняются служебным графом: worktree на задачу, параллельные корзины, закрытие, ретроспектива с lessons learned.",
    files: ["apps/console/src/core/workflows/*", "docs/workflows.md"],
    x: 320,
    y: 430,
  },
  {
    id: "mcp",
    layer: "console",
    title: "MCP-реестр и синк",
    subtitle: "mcp/sync, mcp/client",
    description:
      "Глобальный реестр серверов и синк в конфиги всех рантаймов по правилу managed-имён: таргет управляет только своими записями. mcp/client подключает серверы в процессе консоли и воркера; инструменты агентного цикла - mcp__<server>__<tool>.",
    files: ["apps/console/src/core/mcp/*", "docs/mcp.md"],
    x: 610,
    y: 430,
  },
  {
    id: "providers",
    layer: "provider",
    title: "LLM-провайдеры",
    subtitle: "реестр пресетов + agentLoop",
    description:
      "Пресеты (Ollama, OpenAI-совместимые, Anthropic, Gemini) и записи .agents/providers/<id>/ (key.env вне git). Запросы in-process с SSRF-фильтром; agentLoop - цикл function calling (до 50 вызовов инструментов) с read_file, list_dir, run_command и MCP-инструментами.",
    files: ["apps/console/src/core/providerRun.ts", "apps/console/src/core/agentLoop.ts", "docs/providers.md"],
    x: 880,
    y: 430,
  },
  {
    id: "guardrails",
    layer: "guard",
    title: "Guardrails",
    subtitle: "единый движок политики",
    description:
      "PreToolUse-guard всех семи рантаймов: exit 0 разрешает, exit 2 блокирует с подсказкой \"Instead\" (у Antigravity обёртка переводит вердикт в decision-JSON). Контентный сканер (инъекции, секреты, PII), LLM-обёртки guardPrompt / guardOutput, журнал audit/events.jsonl. Правка самого guard - только через пользователя.",
    files: [".guardrails/src/cli.ts", ".guardrails/README.md"],
    x: 200,
    y: 590,
  },
  {
    id: "state",
    layer: "state",
    title: "Файловое состояние",
    subtitle: ".agents/ - вне git",
    description:
      "Файловое состояние консоли вне Git: state.json, реестр задач tasks/, сессии (sessions.sqlite), direct-чаты (direct/), конфиги рантаймов, роли, навыки (хранилище .agents/skills + симлинки в каталоги рантаймов), каталог цен .agents/pricing/, провайдеры. Запись атомарная (tmp + rename); повреждённый файл не останавливает консоль - чтение с merge на значения по умолчанию.",
    files: [".agents/console/state.json", ".agents/console/tasks/", ".agents/runtime/<vendor>/", ".agents/skills/", ".agents/pricing/"],
    x: 630,
    y: 590,
  },
  {
    id: "tooling",
    layer: "tools",
    title: "Tooling",
    subtitle: "хуки индексов, скрипты, верификация",
    description:
      "tooling/harness - единая обёртка событийных хуков индексов (реестр, бюджеты, журнал, doctor). tooling/scripts - setup.sh, диспетчер агентов tool.sh, verify.ts с четырьмя уровнями верификации через nx. tooling/mcp - мост codegraph.",
    files: ["tooling/harness/src/cli.ts", "tooling/scripts/tool.sh", "tooling/scripts/src/verify.ts"],
    x: 500,
    y: 740,
  },
  {
    id: "design",
    layer: "console",
    title: "Design pack и провайдеры",
    subtitle: "DESIGN.md, BRAND.md, ui-kit, components",
    description:
      "Дизайн-контекст рабочей папки: pack (DESIGN.md в формате @google/design.md, BRAND.md, design/ui-kit.md, design/components.json), пресеты themes/, редакторы токенов, гайда и бренда. Провайдеры дизайна: Claude Design (/design), Open Design (MCP + CLI od), Figma MCP; единый запуск задач через рантайм, провайдера или сессию. Managed-синк pack'а - в CLAUDE.md/AGENTS.md рабочей папки.",
    files: ["apps/console/src/uikit/components/design/*", "docs/design.md"],
    x: 860,
    y: 740,
  },
  {
    id: "roles",
    layer: "workflow",
    title: "Роли агентов",
    subtitle: ".agents/roles/<папка>/<id>.md",
    description:
      "Один файл - одна роль: frontmatter (title, domain, skills, mcp, tools, defaultTier/defaultEffort) и markdown-секции (Роль, Правила работы, Принципы работы, Оценка входных данных, Оценка своей работы). Каталог: product/execution/engineering, engineering разбит по доменам. Роли шага - исполнители и контроли: инструкции всех ролей идут одним промптом, skills и mcp роли подключаются к шагу; /agent:<id> - роль в direct-чате.",
    files: [".agents/roles/**", "docs/roles.md"],
    x: 620,
    y: 900,
  },
  {
    id: "skills",
    layer: "runtime",
    title: "Навыки",
    subtitle: ".agents/skills: master, design, skills.sh",
    description:
      "Процедурные знания агентов (SKILL.md). Шесть лейблов единого списка: internal (мастер-каталог, manifest.yaml + evals), design, skills.sh, plugin, workflow (без тоггла) и runtime. Каноническое хранилище - .agents/skills; тоггл выполняет хуки: симлинк (cursor - зеркало с hardlink'ами, kimi читает канон нативно) + команды манифеста после guard-проверки. Синк команд: /master:<id> и /workflow:<id> становятся нативными слэш-командами рантаймов.",
    files: [".agents/skills/**", "apps/console/src/core/skillRegistry.ts", "docs/skills.md"],
    x: 40,
    y: 900,
  },
  {
    id: "workflow-yaml",
    layer: "workflow",
    title: "Workflow YAML",
    subtitle: ".agents/skills/master/workflows",
    description:
      "Декларативный каталог графов: шаги с секциями inputControl/execution/outputControl, dependsOn, runtime.candidates, retry, ресурсы workspace (read/write/worktree). Наследование extends; валидатор отклоняет циклы DAG, цикл наследования, неизвестные зависимости, граф более 100 шагов и несоединённые узлы. Мастер-каталог дополняет прежний корневой .agents/workflows (fallback); каталог рабочей папки перекрывает оба по ID; id уникальны во всей системе.",
    files: [".agents/skills/master/workflows", "docs/workflows.md"],
    x: 360,
    y: 900,
  },
  {
    id: "tools",
    layer: "tools",
    title: "Инструменты",
    subtitle: "экономия контекста и память",
    description:
      "Плагины инструментов: serena, codegraph, graphify, qmd, rtk, headroom, nx, openwiki, open-design, agentplane, codeburn и связки памяти neo4j + lightrag / neo4j + qdrant. Жизненный цикл - \"Настройки → Инструменты\"; вызов агентами - только через диспетчер tool.sh. Там же - реестр обновлений зависимостей (npm/PyPI/GitHub/brew) с job'ом обновления.",
    files: ["apps/console/src/core/tools/*", "docs/tools.md"],
    x: 260,
    y: 740,
  },
  {
    id: "workspaces",
    layer: "folders",
    title: "Рабочие папки",
    subtitle: "обязательная + дополнительные, sources/",
    description:
      "Папки, в которых работают агенты: обязательная рабочая папка и дополнительные (по умолчанию docs/ и sources/); фильтруют сессии, задачи и дизайн-контекст. Локальные проекты клонируются в sources/ по https (job с SSRF-фильтром хоста, вне git). Тогглы папки включают её в сборки OpenWiki, Graphify и раздел Docs; симлинки навыков ставятся в обязательную папку.",
    files: ["apps/console/src/core/state.ts", "docs/operations.md"],
    x: 40,
    y: 1060,
  },
  {
    id: "knowledge",
    layer: "tools",
    title: "Знание",
    subtitle: "Docs, OpenWiki, Graphify, память",
    description:
      "Раздел \"Знание\": деревья markdown-документов рабочих папок, сборка вики OpenWiki (CLI с LLM-провайдером или headless-агентом), воркспейсы wiki нескольких папок, графы Graphify (воркспейс graphify/<имя>/graphify-out на папку: extract, cluster, export wiki, публикация graph.html), визуализатор и вкладка \"Память\" (memory-файлы рантаймов, связки neo4j + lightrag / qdrant).",
    files: ["apps/console/src/core/memory.ts", "apps/console/src/core/graphify.ts", "docs/operations.md"],
    x: 860,
    y: 900,
  },
  {
    id: "plugins",
    layer: "console",
    title: "Плагины и моды",
    subtitle: "бандлы MCP(+навыков), marketplace, моды Claude",
    description:
      "Плагины - бандлы MCP-серверов и навыков: включённый плагин добавляет свои серверы в общий реестр (и синк), выключенный - убирает; builtin Chrome DevTools; каталоги - marketplace-манифесты по https. Моды Claude Code - плагины с hooks-модулями: установка через claude plugin marketplace add + install, shallow-clone для репозиториев; без CLI claude действия блокируются. Хуки жизненного цикла исполняются после guard-проверки.",
    files: ["apps/console/src/core/plugins.ts", "apps/console/src/core/mods.ts", "docs/plugins.md"],
    x: 1150,
    y: 590,
  },
  {
    id: "observability",
    layer: "console",
    title: "Наблюдаемость",
    subtitle: "задачи, процессы, статистика, оптимизация",
    description:
      "Мониторинг и метрики: реестр задач консоли (промты, запросы провайдерам, сборки), инвентаризация процессов (cpu/mem/uptime, маркер \"безопасно остановить\"), event ledger workflow и статистика (runs, attempts, токены, стоимость, heatmap по дням), оптимизация - отчёты Claude Insights и CodeBurn с запуском рекомендаций у исполнителя задач.",
    files: ["apps/console/src/core/tasks.ts", "apps/console/src/core/processInventory.ts", "docs/stats.md"],
    x: 1150,
    y: 430,
  },
];

export const ARCH_EDGES: ArchEdgeSpec[] = [
  { from: "user", to: "console-ui", fromSide: "bottom", toSide: "top", label: "HTTP: RSC / JSON / SSE" },
  { from: "console-ui", to: "console-api", fromSide: "right", toSide: "left", label: "fetch" },
  { from: "console-api", to: "console-core", fromSide: "bottom", toSide: "top", label: "роуты → ядро" },
  { from: "console-core", to: "console-lib", fromSide: "right", toSide: "left", label: "fs, ps, toml" },
  { from: "console-core", to: "console-adapters", fromSide: "left", toSide: "right", label: "пробы, запуск" },
  { from: "console-adapters", to: "runtimes", fromSide: "bottom", toSide: "top", label: "headless-CLI (spawn)" },
  { from: "console-core", to: "workflow", fromSide: "bottom", toSide: "top", label: "SQLite-команды / SSE" },
  { from: "console-core", to: "guardrails", fromSide: "bottom", toSide: "top", label: "run_command: guard" },
  { from: "console-core", to: "mcp", fromSide: "right", toSide: "top", label: "mcp/client" },
  { from: "console-core", to: "providers", fromSide: "right", toSide: "top", label: "agentLoop (in-process)" },
  { from: "console-core", to: "state", fromSide: "bottom", toSide: "top", label: "чтение / атомарная запись" },
  { from: "workflow", to: "guardrails", fromSide: "bottom", toSide: "top", label: "guardPrompt / guardOutput" },
  { from: "workflow", to: "runtimes", fromSide: "left", toSide: "right", label: "исполнители шагов" },
  { from: "workflow", to: "providers", fromSide: "bottom", toSide: "bottom", label: "provider:<id>" },
  { from: "runtimes", to: "guardrails", fromSide: "bottom", toSide: "left", label: "PreToolUse-хуки" },
  { from: "mcp", to: "state", fromSide: "bottom", toSide: "top", label: "managed-синк" },
  { from: "runtimes", to: "tooling", fromSide: "bottom", toSide: "top", label: "хуки индексов" },
  { from: "tooling", to: "state", fromSide: "right", toSide: "bottom", label: "tools.env, статусы" },
  { from: "tooling", to: "tools", fromSide: "left", toSide: "right", label: "tool.sh" },
  { from: "console-core", to: "design", fromSide: "bottom", toSide: "top", label: "design API: pack, синк, задачи" },
  { from: "workflow-yaml", to: "workflow", fromSide: "top", toSide: "bottom", label: "загрузка каталога" },
  { from: "roles", to: "workflow", fromSide: "top", toSide: "bottom", label: "роли шагов: DoR, план, контроль" },
  { from: "skills", to: "runtimes", fromSide: "top", toSide: "bottom", label: "симлинки, команды манифеста" },
  { from: "design", to: "providers", fromSide: "top", toSide: "bottom", label: "запуск задач: провайдер" },
  { from: "providers", to: "mcp", fromSide: "left", toSide: "right", label: "MCP-инструменты цикла" },
  { from: "workflow", to: "state", fromSide: "bottom", toSide: "left", label: "SQLite прогона, ledger, чекпоинты" },
  { from: "workflow-yaml", to: "skills", fromSide: "left", toSide: "right", label: "workflowsRoot: каталог в хранилище" },
  { from: "console-core", to: "plugins", fromSide: "bottom", toSide: "top", label: "жизненный цикл, marketplace" },
  { from: "plugins", to: "mcp", fromSide: "bottom", toSide: "bottom", label: "серверы в реестр" },
  { from: "plugins", to: "skills", fromSide: "bottom", toSide: "top", label: "плагинные навыки" },
  { from: "tools", to: "knowledge", fromSide: "bottom", toSide: "top", label: "graphify, qmd, openwiki" },
  { from: "console-core", to: "knowledge", fromSide: "bottom", toSide: "right", label: "сборки OpenWiki и Graphify" },
  { from: "console-core", to: "observability", fromSide: "right", toSide: "top", label: "задачи, процессы, ledger, usage" },
  { from: "runtimes", to: "workspaces", fromSide: "bottom", toSide: "top", label: "cwd сессий, задач, сборок" },
];

export const ARCH_FLOWS: ArchFlow[] = [
  {
    id: 1,
    title: "Headless-запуск",
    description:
      "Консоль запускает рантаймы литеральными командами без оболочки; вывод стримится из лог-файла, каждый запуск попадает в реестр задач.",
  },
  {
    id: 2,
    title: "Workflow",
    description:
      "Консоль пишет команды в SQLite, Bun worker исполняет граф LangGraph и отдаёт события по SSE; run переживает закрытие браузера.",
  },
  {
    id: 3,
    title: "Состояние",
    description:
      "Консоль читает конфиги и сессии, пробит процессы одним ps-срезом, пишет state.json атомарно; клиентский стор не опережает файл.",
  },
  {
    id: 4,
    title: "Guard-политика",
    description:
      "PreToolUse-хуки рантаймов, run_command консоли и LLM-трафик workflow проходят единый движок: exit 0 разрешает, exit 2 блокирует с подсказкой Instead.",
  },
  {
    id: 5,
    title: "Исполнители шагов",
    description:
      "Шаги workflow исполняют CLI-рантаймы (каждый со своими guard-хуками) и провайдеры AI SDK в формате provider:<id> в процессе консоли.",
  },
  {
    id: 6,
    title: "Хуки индексов",
    description:
      "Событийные хуки Serena, CodeGraph и Graphify вызывают единственную обёртку tooling/harness/src/cli.ts - реестр, бюджеты, журнал.",
  },
  {
    id: 7,
    title: "Сборка знания",
    description:
      "Консоль запускает openwiki --init/--update и graphify extract/cluster/wiki в рабочей папке (отвязанные процессы); артефакты - вики и graph.json - читает раздел \"Знание\", агенты запрашивают их через MCP и tool.sh.",
  },
];

export const ARCH_LAYER_BY_ID: Record<ArchLayerId, ArchLayer> = Object.fromEntries(
  ARCH_LAYERS.map((l) => [l.id, l]),
) as Record<ArchLayerId, ArchLayer>;
