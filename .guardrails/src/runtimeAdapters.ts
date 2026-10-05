// Реестр рантайм-адаптеров Guardrails: единый источник сведений о точках
// подключения политики. Добавление нового рантайма - новая запись
// RUNTIME_ADAPTERS: записи интеграций аудита выводятся из реестра,
// `bun .guardrails/src/adapters.ts check` сверяет файлы, `render`
// печатает готовые фрагменты для конфигурации рантайма.

export interface RuntimeHookSpec {
  /** Имя события в терминах рантайма. */
  event: string;
  /** Файл подключения от корня репозитория. */
  file: string;
  /** Строка, наличие которой подтверждает подключение. */
  marker: string;
  /** Фактическая команда хука. */
  command: string;
  /** Регулярное выражение по инструменту, если рантайм поддерживает matcher. */
  matcher?: string;
  purpose: string;
  protects: string;
  notes: string;
  failMode: "closed" | "open";
}

export interface RuntimeAdapter {
  id: string;
  title: string;
  hooks: RuntimeHookSpec[];
  /** Подключение guard к LLM-пути: обёртка моделей и узел LangGraph рантаймо-независимы. */
  llmGuard: "wrapped" | "manual" | "none";
  extensionNotes: string;
}

const evaluate = (projectDirVar: string, runtime: string, wrapper = ""): string =>
  `${wrapper}AGENT_RUNTIME=${runtime} AGENT_RUNTIME_CONFIG=\${${projectDirVar}}/.agents/runtime/${runtime}/config.json GUARDRAILS_INTEGRATION=runtime:${runtime}:PreToolUse bun "\${${projectDirVar}}/.guardrails/src/cli.ts" evaluate`;

const prompt = (projectDirVar: string, runtime: string): string =>
  `command -v bun >/dev/null 2>&1 && AGENT_RUNTIME=${runtime} AGENT_RUNTIME_CONFIG=\${${projectDirVar}}/.agents/runtime/${runtime}/config.json GUARDRAILS_INTEGRATION=runtime:${runtime}:UserPromptSubmit bun "\${${projectDirVar}}/.guardrails/src/cli.ts" prompt || exit 0`;

const posttooluse = (projectDirVar: string, runtime: string): string =>
  `AGENT_RUNTIME=${runtime} AGENT_RUNTIME_CONFIG=\${${projectDirVar}}/.agents/runtime/${runtime}/config.json GUARDRAILS_INTEGRATION=runtime:${runtime}:PostToolUse bun "\${${projectDirVar}}/.guardrails/src/posttooluse.ts"`;

const TOOLS = "Bash|Write|Edit|Read|Grep|Glob";

export const RUNTIME_ADAPTERS: RuntimeAdapter[] = [
  {
    id: "claude",
    title: "Claude Code",
    hooks: [
      {
        event: "PreToolUse", file: ".claude/settings.json", marker: ".guardrails/src/cli.ts",
        command: evaluate("CLAUDE_PROJECT_DIR", "claude"), matcher: TOOLS,
        purpose: "Проверяет вызов инструмента до его исполнения в агентном runtime.",
        protects: "Рабочее дерево, секреты, Git, данные и инфраструктуру от опасных действий агента.",
        notes: "Нативный PreToolUse.", failMode: "closed",
      },
      {
        event: "UserPromptSubmit", file: ".claude/settings.json", marker: ".guardrails/src/cli.ts",
        command: prompt("CLAUDE_PROJECT_DIR", "claude"),
        purpose: "Скан промпта на инъекции, маркеры конфиденциальности и многоходовые PII-зонды.",
        protects: "Контекст модели от инъекций; персональные данные от сбора через диалог.",
        notes: "Инъекции и PII-зонды в промпте; fail-open.", failMode: "open",
      },
      {
        event: "PostToolUse", file: ".claude/settings.json", marker: "posttooluse.ts",
        command: posttooluse("CLAUDE_PROJECT_DIR", "claude"), matcher: "Bash|Read|Grep|Glob|WebFetch|WebSearch",
        purpose: "Скан вывода инструмента после исполнения до передачи в модель.",
        protects: "Контекст модели от непрямых инъекций; transcript от секретов и персональных данных.",
        notes: "Инъекция - exit 2 с указанием модели; сбой скана не блокирует.", failMode: "closed",
      },
    ],
    llmGuard: "manual",
    extensionNotes: "Новый рантайм Claude-семейства: переиспользуйте три события с переменной проекта своего рантайма.",
  },
  {
    id: "codex",
    title: "Codex",
    hooks: [
      {
        event: "PreToolUse", file: ".codex/hooks.json", marker: ".guardrails/src/cli.ts",
        command: `AGENT_RUNTIME=codex AGENT_RUNTIME_CONFIG=.agents/runtime/codex/config.json GUARDRAILS_INTEGRATION=runtime:codex:PreToolUse bun .guardrails/src/cli.ts evaluate`, matcher: TOOLS,
        purpose: "Проверяет вызов инструмента до его исполнения в агентном runtime.",
        protects: "Рабочее дерево, секреты, Git, данные и инфраструктуру от опасных действий агента.",
        notes: "Активен после доверия каталогу .codex/.", failMode: "closed",
      },
    ],
    llmGuard: "manual",
    extensionNotes: "Codex не поддерживает UserPromptSubmit и PostToolUse; правила промптов - в AGENTS.md.",
  },
  {
    id: "zcode",
    title: "ZCode",
    hooks: [
      {
        event: "PreToolUse", file: ".zcode/config.json", marker: ".guardrails/src/cli.ts",
        command: evaluate("ZCODE_PROJECT_DIR", "zcode"), matcher: TOOLS,
        purpose: "Проверяет вызов инструмента до его исполнения в агентном runtime.",
        protects: "Рабочее дерево, секреты, Git, данные и инфраструктуру от опасных действий агента.",
        notes: "Нативный PreToolUse.", failMode: "closed",
      },
      {
        event: "UserPromptSubmit", file: ".zcode/config.json", marker: ".guardrails/src/cli.ts",
        command: prompt("ZCODE_PROJECT_DIR", "zcode"),
        purpose: "Скан промпта на инъекции, маркеры конфиденциальности и многоходовые PII-зонды.",
        protects: "Контекст модели от инъекций; персональные данные от сбора через диалог.",
        notes: "Инъекции и PII-зонды в промпте; fail-open.", failMode: "open",
      },
      {
        event: "PostToolUse", file: ".zcode/config.json", marker: "posttooluse.ts",
        command: posttooluse("ZCODE_PROJECT_DIR", "zcode"), matcher: "Bash|Read|Grep|Glob|WebFetch|WebSearch",
        purpose: "Скан вывода инструмента после исполнения до передачи в модель.",
        protects: "Контекст модели от непрямых инъекций; transcript от секретов и персональных данных.",
        notes: "Инъекция - exit 2 с указанием модели; сбой скана не блокирует.", failMode: "closed",
      },
    ],
    llmGuard: "manual",
    extensionNotes: "Статусы хук-событий пишутся в .mimosa/hook-status по схеме mimosa-hook-status/v1 - дашборд консоли видит активность без привязки к vendor.",
  },
  {
    id: "cursor",
    title: "Cursor",
    hooks: [
      {
        event: "preToolUse", file: ".cursor/hooks.json", marker: ".guardrails/src/cli.ts",
        command: `AGENT_RUNTIME=cursor AGENT_RUNTIME_CONFIG="$CURSOR_PROJECT_DIR/.agents/runtime/cursor/config.json" GUARDRAILS_INTEGRATION=runtime:cursor:preToolUse bun "$CURSOR_PROJECT_DIR/.guardrails/src/cli.ts" evaluate`,
        purpose: "Проверяет вызов инструмента до его исполнения в агентном runtime.",
        protects: "Рабочее дерево, секреты, Git, данные и инфраструктуру от опасных действий агента.",
        notes: "Guardrails-хук работает в режиме fail-closed.", failMode: "closed",
      },
    ],
    llmGuard: "manual",
    extensionNotes: "Cursor поддерживает только preToolUse; UserPromptSubmit и PostToolUse не доступны.",
  },
  {
    id: "kimi",
    title: "Kimi Code",
    hooks: [
      {
        event: "PreToolUse", file: ".kimi/config.toml", marker: ".guardrails/src/cli.ts",
        command: `sh -c 'if [ -f .guardrails/src/cli.ts ]; then AGENT_RUNTIME=kimi AGENT_RUNTIME_CONFIG=.agents/runtime/kimi/config.json GUARDRAILS_INTEGRATION=runtime:kimi:PreToolUse bun .guardrails/src/cli.ts evaluate; else exit 0; fi'`,
        purpose: "Проверяет вызов инструмента до его исполнения в агентном runtime.",
        protects: "Рабочее дерево, секреты, Git, данные и инфраструктуру от опасных действий агента.",
        notes: "Требуется зеркало в пользовательском config.toml.", failMode: "closed",
      },
    ],
    llmGuard: "manual",
    extensionNotes: "Kimi читает только пользовательский config.toml: после добавления блоков [[hooks]] скопируйте их в ~/.kimi-code/config.toml. Поддержка UserPromptSubmit и PostToolUse требует проверки событий версии Kimi Code.",
  },
  {
    id: "opencode",
    title: "OpenCode",
    hooks: [
      {
        event: "tool.execute.before", file: ".opencode/plugins/agentos-guard.ts", marker: ".guardrails/src/cli.ts",
        command: `плагин Bun: Bun.spawnSync .guardrails/src/cli.ts evaluate`,
        purpose: "Проверяет вызов инструмента до его исполнения в агентном runtime.",
        protects: "Рабочее дерево, секреты, Git, данные и инфраструктуру от опасных действий агента.",
        notes: "Плагин Bun блокирует вызов при любом сбое Guardrails.", failMode: "closed",
      },
      {
        event: "tool.execute.after", file: ".opencode/plugins/agentos-guard.ts", marker: "posttooluse.ts",
        command: `плагин Bun: Bun.spawnSync .guardrails/src/posttooluse.ts`,
        purpose: "Скан вывода инструмента после исполнения до передачи в модель.",
        protects: "Контекст модели от непрямых инъекций; transcript от секретов и персональных данных.",
        notes: "Блокировка после исполнения невозможна: находки уходят в журнал и лог плагина.", failMode: "open",
      },
    ],
    llmGuard: "manual",
    extensionNotes: "OpenCode не имеет декларативных хуков: события подключаются плагином .opencode/plugins/agentos-guard.ts.",
  },
];

export const EVENT_BUNDLES: Record<string, string> = {
  PreToolUse: "baseline",
  preToolUse: "baseline",
  "tool.execute.before": "baseline",
  UserPromptSubmit: "prompt",
  PostToolUse: "tool-output",
  "tool.execute.after": "tool-output",
};

export function adapterById(id: string): RuntimeAdapter | undefined {
  return RUNTIME_ADAPTERS.find((adapter) => adapter.id === id);
}
