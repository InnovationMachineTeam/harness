/**
 * Данные представлений "Система", "Потоки" и "Данные" вкладки "Архитектура".
 * Источник - docs/architecture-interactive.html (перенос статических данных);
 * описания синхронизированы с docs/architecture.md (Плоскости исполнения,
 * Основные сквозные потоки, Данные и инварианты).
 */

export type ViewGroupId = "control" | "execution" | "policy" | "data" | "external";

export interface ViewGroup {
  id: ViewGroupId;
  label: string;
  /** Цвет контура - токен DESIGN.md. */
  color: string;
}

export const VIEW_GROUPS: ViewGroup[] = [
  { id: "control", label: "Control plane", color: "#50fa7b" },
  { id: "execution", label: "Execution", color: "#f1fa8c" },
  { id: "policy", label: "Policy", color: "#ff5555" },
  { id: "data", label: "Data", color: "#8be9fd" },
  { id: "external", label: "External", color: "#a9adcd" },
];

export const VIEW_GROUP_BY_ID: Record<ViewGroupId, ViewGroup> = Object.fromEntries(
  VIEW_GROUPS.map((g) => [g.id, g]),
) as Record<ViewGroupId, ViewGroup>;

export interface SystemNode {
  id: string;
  title: string;
  subtitle: string;
  group: ViewGroupId;
  x: number;
  y: number;
  responsibility: string;
  owner: string;
  failure: string;
  source: string;
}

export const SYSTEM_NODES: SystemNode[] = [
  {
    id: "developer",
    title: "Разработчик",
    subtitle: "Browser + CLI",
    group: "external",
    x: 502,
    y: 28,
    responsibility: "Управляет рантаймами, рабочими папками, workflow и локальными инструментами через Console или CLI.",
    owner: "Человек; Harness хранит только выбранные настройки и историю операций.",
    failure: "Ошибочный ввод отклоняется серверной валидацией и guard-политикой.",
    source: "apps/console/src/app",
  },
  {
    id: "console",
    title: "Harness Console",
    subtitle: "UI · API · core",
    group: "control",
    x: 212,
    y: 174,
    responsibility: "Локальная control plane: UI, Route Handlers, доменные сервисы, адаптеры рантаймов и мониторинг.",
    owner: "Владеет .agents/console и managed-проекциями конфигурации.",
    failure: "После HMR или рестарта перечитывает файловое состояние и SQLite.",
    source: "apps/console/src",
  },
  {
    id: "guard",
    title: "Guardrails",
    subtitle: "policy · audit",
    group: "policy",
    x: 502,
    y: 174,
    responsibility: "Проверяет tool-вызовы, контент и пути до побочного эффекта; возвращает allow, warn или block.",
    owner: "Каталог правил, исключения и схемы в .guardrails.",
    failure: "Повреждённый payload закрывается fail-closed; решение попадает в audit log.",
    source: ".guardrails/src/cli.ts",
  },
  {
    id: "hooks",
    title: "Hook tooling",
    subtitle: "indexes · doctor",
    group: "policy",
    x: 792,
    y: 174,
    responsibility: "Агрегирует lifecycle hooks Serena, CodeGraph и Graphify, проверяет wiring и бюджеты.",
    owner: "Реестр hook wiring в tooling/harness/src/registry.ts.",
    failure: "Необязательный индекс деградирует без подмены решения Guard.",
    source: "tooling/harness/src",
  },
  {
    id: "state",
    title: ".agents",
    subtitle: "config · roles · runs",
    group: "data",
    x: 502,
    y: 326,
    responsibility: "Каноническое проектное и локальное состояние: runtime config, skills, roles, tasks, runs и ledgers.",
    owner: "Каждый подкаталог имеет отдельного владельца; managed-области явно маркированы.",
    failure: "Атомарные записи и defaults позволяют восстановиться после частичного файла.",
    source: ".agents/",
  },
  {
    id: "worker",
    title: "Workflow worker",
    subtitle: "LangGraph · lease",
    group: "execution",
    x: 212,
    y: 326,
    responsibility: "Выполняет immutable snapshot workflow, пишет attempts, events, usage и checkpoints.",
    owner: "Отдельная workflows.sqlite для каждой выбранной рабочей папки.",
    failure: "После аварии run становится interrupted и возобновляется оператором через retry/restart.",
    source: "apps/console/src/core/workflows",
  },
  {
    id: "runtimes",
    title: "Agent runtimes",
    subtitle: "6 vendor adapters",
    group: "execution",
    x: 126,
    y: 510,
    responsibility: "Claude Code, Codex, ZCode, Cursor, Kimi и OpenCode выполняют headless-задачи и владеют форматами сессий.",
    owner: "Vendor config в .agents/runtime/<vendor>; сессии принадлежат самим runtime.",
    failure: "Probe и timeout переводят вызов в failover или structured error.",
    source: "apps/console/src/runtimes",
  },
  {
    id: "providers",
    title: "LLM + MCP",
    subtitle: "remote / local",
    group: "external",
    x: 408,
    y: 510,
    responsibility: "LLM-провайдеры исполняют model calls, MCP-серверы предоставляют инструменты через namespaced contracts.",
    owner: "Provider settings хранятся локально; удалёнными моделями Harness не владеет.",
    failure: "Timeout, SSRF policy, auth error и unavailable server дают контролируемую ошибку.",
    source: "apps/console/src/core/providers.ts · core/mcp",
  },
  {
    id: "tools",
    title: "Local tools",
    subtitle: "graph · wiki · index",
    group: "external",
    x: 690,
    y: 510,
    responsibility: "Подключаемые CLI-инструменты строят индексы, wiki, графы и диагностику через единый lifecycle.",
    owner: "ToolDef registry и tooling/scripts/tool.sh.",
    failure: "TOOL_UNAVAILABLE - штатная деградация; автоматическая установка запрещена.",
    source: "apps/console/src/core/tools · tooling/scripts/tool.sh",
  },
  {
    id: "workspace",
    title: "User workspaces",
    subtitle: "source · docs · git",
    group: "data",
    x: 972,
    y: 510,
    responsibility: "Рабочие репозитории и папки, в которых агенты читают, изменяют и проверяют результат.",
    owner: "Пользователь; Harness действует только в разрешённых workspace roots.",
    failure: "realpath containment и secret-path policy блокируют выход за разрешённую границу.",
    source: "apps/console/src/lib/server-context.ts",
  },
];

export const SYSTEM_EDGES: [string, string][] = [
  ["developer", "console"],
  ["developer", "guard"],
  ["developer", "hooks"],
  ["console", "guard"],
  ["hooks", "guard"],
  ["console", "state"],
  ["guard", "state"],
  ["hooks", "state"],
  ["console", "worker"],
  ["worker", "runtimes"],
  ["worker", "providers"],
  ["state", "tools"],
  ["state", "workspace"],
  ["runtimes", "workspace"],
  ["tools", "workspace"],
];

export interface FlowStep {
  id: string;
  title: string;
  subtitle: string;
  group: ViewGroupId;
}

export interface FlowSpec {
  id: string;
  title: string;
  description: string;
  steps: FlowStep[];
}

export const FLOWS: FlowSpec[] = [
  {
    id: "direct",
    title: "Прямой агентский запрос",
    description: "Сообщение проходит раскрытие команд, выбранный executor, guard и потоковый ответ.",
    steps: [
      { id: "message", title: "Сообщение", subtitle: "slash + @path", group: "external" },
      { id: "resolve", title: "Command resolver", subtitle: "skills · roles · files", group: "control" },
      { id: "executor", title: "Runtime / provider", subtitle: "LangGraph or headless", group: "execution" },
      { id: "guard-call", title: "Guard + tools", subtitle: "builtin · MCP", group: "policy" },
      { id: "stream", title: "Stream + ledger", subtitle: "UI · task · usage", group: "data" },
    ],
  },
  {
    id: "workflow",
    title: "Workflow run",
    description: "Snapshot делает запуск воспроизводимым, worker хранит прогресс и требует управляемого восстановления.",
    steps: [
      { id: "yaml", title: "Workflow YAML", subtitle: "roles · candidates", group: "external" },
      { id: "preflight", title: "Preflight", subtitle: "validate · resolve", group: "control" },
      { id: "snapshot", title: "Immutable snapshot", subtitle: "config · policy", group: "data" },
      { id: "worker-flow", title: "Worker pipeline", subtitle: "input · execute · output", group: "execution" },
      { id: "checkpoint", title: "Events + checkpoint", subtitle: "SQLite · SSE", group: "data" },
    ],
  },
  {
    id: "sync",
    title: "Синхронизация конфигурации",
    description: "Канонический реестр проецируется в vendor-файлы, сохраняя пользовательские записи.",
    steps: [
      { id: "registry", title: "Canonical registry", subtitle: "MCP · skills · commands", group: "data" },
      { id: "validate", title: "Manifest validation", subtitle: "schema · lifecycle", group: "policy" },
      { id: "persist", title: "Atomic persist", subtitle: "state before response", group: "control" },
      { id: "adapter", title: "Sync adapter", subtitle: "managed names only", group: "execution" },
      { id: "vendor", title: "Vendor configs", subtitle: "per-target result", group: "external" },
    ],
  },
  {
    id: "guard",
    title: "Проверка tool-вызова",
    description: "Одна политика применяется в native hooks и серверных executors до побочного эффекта.",
    steps: [
      { id: "payload", title: "Tool payload", subtitle: "name · input · runtime", group: "external" },
      { id: "normalize", title: "Normalize context", subtitle: "command · paths", group: "control" },
      { id: "rules", title: "Rules + exceptions", subtitle: "deterministic match", group: "policy" },
      { id: "decision", title: "Decision", subtitle: "allow · warn · block", group: "policy" },
      { id: "audit", title: "Audit", subtitle: "rule id · digest", group: "data" },
    ],
  },
];

export interface DataNode {
  id: string;
  title: string;
  subtitle: string;
  group: ViewGroupId;
  x: number;
  y: number;
  responsibility: string;
  owner: string;
  failure: string;
  source: string;
}

export const DATA_NODES: DataNode[] = [
  {
    id: "state-json",
    title: "Console state",
    subtitle: "state.json",
    group: "data",
    x: 92,
    y: 105,
    responsibility: "Настройки, registry и выбранные workspaces.",
    owner: "Console core/state.ts",
    failure: "tmp + rename; merge with defaults.",
    source: ".agents/console/state.json",
  },
  {
    id: "workflow-db",
    title: "Workflow DB",
    subtitle: "workflows.sqlite",
    group: "data",
    x: 368,
    y: 74,
    responsibility: "Runs, attempts, events, commands, checkpoints и usage.",
    owner: "WorkflowStore",
    failure: "Lease + interrupted status + operator recovery.",
    source: ".agents/console/workspaces/<key>/workflows.sqlite",
  },
  {
    id: "sessions-db",
    title: "Session index",
    subtitle: "sessions.sqlite",
    group: "data",
    x: 652,
    y: 105,
    responsibility: "Производный полнотекстовый индекс runtime sessions.",
    owner: "sessionsIndex collector",
    failure: "Перестраивается по cursor без изменения источника.",
    source: ".agents/console/sessions.sqlite",
  },
  {
    id: "provider-files",
    title: "Provider files",
    subtitle: "settings · key · CA",
    group: "policy",
    x: 920,
    y: 210,
    responsibility: "Параметры провайдера разделены от секретов и сертификата.",
    owner: "providerSettings.ts",
    failure: "Невалидная конфигурация даёт inactive/error.",
    source: ".agents/providers/<id>/",
  },
  {
    id: "canonical",
    title: "Canonical catalogs",
    subtitle: "skills · roles · runtime",
    group: "control",
    x: 92,
    y: 410,
    responsibility: "Версионируемые определения поведения и runtime policy.",
    owner: "Repository",
    failure: "Validation и docs checks до интеграции.",
    source: ".agents/skills · .agents/roles · .agents/runtime",
  },
  {
    id: "guard-data",
    title: "Guard policy",
    subtitle: "rules · exceptions · audit",
    group: "policy",
    x: 368,
    y: 486,
    responsibility: "Исполняемая политика и журнал решений.",
    owner: "@harness/guardrails",
    failure: "Fail-closed для повреждённого payload.",
    source: ".guardrails/",
  },
  {
    id: "ledgers",
    title: "Task ledgers",
    subtitle: "direct · tasks · runs",
    group: "data",
    x: 652,
    y: 486,
    responsibility: "Переживающие HMR журналы задач, direct chats и процессов.",
    owner: "Console services",
    failure: "Файловый формат читается независимо от web process.",
    source: ".agents/console/{direct,tasks,runs,logs}",
  },
  {
    id: "derived",
    title: "Derived knowledge",
    subtitle: "wiki · graphs · indexes",
    group: "external",
    x: 920,
    y: 410,
    responsibility: "Ускоряет поиск, объяснение и навигацию по репозиторию.",
    owner: "OpenWiki / Graphify / Serena / CodeGraph / QMD",
    failure: "Устаревание ухудшает поиск, но не меняет runtime behavior.",
    source: "openwiki · graphify-out · .codegraph · .serena",
  },
  {
    id: "invariants",
    title: "Durability contract",
    subtitle: "persist before visible",
    group: "execution",
    x: 510,
    y: 286,
    responsibility: "Связывает атомарность, managed ownership, snapshots и recovery.",
    owner: "Cross-cutting architecture",
    failure: "Нарушение проявляется как рассинхронизация UI, повторный side effect или невоспроизводимый run.",
    source: "docs/architecture.md#данные-и-инварианты",
  },
];

/** Все хранилища связаны с контрактом долговечности. */
export const DATA_EDGES: [string, string][] = DATA_NODES.filter((n) => n.id !== "invariants").map((n) => [n.id, "invariants"]);
