/**
 * Общие типы консоли: агностичны к конкретным рантаймам.
 * Новый рантайм подключается адаптером (см. src/runtimes) - эти типы не меняются.
 */

export type ActivityStatus = "active-now" | "recently-active" | "inactive" | "disabled" | "unknown";
export type ActivityScope = "repo" | "machine";

/** Единичный след активности: когда, в каком масштабе и откуда он виден. */
export interface ActivitySignal {
  at: Date;
  scope: ActivityScope;
  /** Человекочитаемый источник (путь с ~, имя файла) - без содержимого сессий. */
  source: string;
}

export interface ProcessInfo {
  pid: number;
  /** Укороченная командная строка процесса. */
  command: string;
}

/** Файловые сигналы, доступные адаптерам через ProbeContext. */
export interface FileEntry {
  /** Абсолютный путь. */
  path: string;
  /** Путь относительно корня обхода. */
  relPath: string;
  name: string;
  mtime: Date;
}

export interface FsSignalHelpers {
  exists(path: string): Promise<boolean>;
  mtimeOf(path: string): Promise<Date | null>;
  collectFiles(
    dir: string,
    opts?: {
      match?: (name: string) => boolean;
      maxDepth?: number;
      limit?: number;
      /** Потолок осмотренных файлов - защита от гигантских каталогов. */
      scanLimit?: number;
      /** Поддерево исключено из обхода (относительный путь файла/каталога). */
      exclude?: (relPath: string) => boolean;
    },
  ): Promise<FileEntry[]>;
  newestMtime(
    dir: string,
    opts?: { match?: (name: string) => boolean; maxDepth?: number; scanLimit?: number },
  ): Promise<{ at: Date; source: string } | null>;
  headJsonLine(path: string): Promise<Record<string, unknown> | null>;
  /** Текст файла (первые maxBytes байт) - для описаний навыков и конфигов. */
  readText(path: string, maxBytes?: number): Promise<string | null>;
  /** Последние maxBytes байт файла как текст - для хвостов сессий. */
  readLastChunk(path: string, maxBytes?: number): Promise<string>;
  /** Первые maxBytes байт файла как текст. */
  readFirstChunk(path: string, maxBytes?: number): Promise<string>;
}

export interface ProbeContext {
  repoRoot: string;
  home: string;
  fs: FsSignalHelpers;
  /** Рабочие папки из состояния консоли (обязательная + дополнительные). */
  workspaces: string[];
}

/**
 * Адаптер рантайма. Ключевая точка модульности: актуальные сигналы активности
 * опциональны - без них карточка строится из vendor-конфига (generic).
 */
export interface RuntimeAdapter {
  /** Совпадает с именем каталога в .agents/runtime/<id>/. */
  id: string;
  displayName: string;
  /** Матчер строки ps для детектора запущенных процессов. */
  processPattern?: RegExp;
  /**
   * Установлен ли рантайм на этой машине (по маркерам установки - каталогам
   * данных/приложения). false → статус "disabled", актуальные сигналы не ищутся.
   */
  isInstalled?(ctx: ProbeContext): Promise<boolean>;
  probeSignals?(ctx: ProbeContext): Promise<ActivitySignal[]>;
  /** Глобальные навыки/скрипты/агенты рантайма (read-only дискавери). */
  listSkills?(ctx: ProbeContext): Promise<SkillItem[]>;
  /** Диагностика: проблемы хуков/конфигов конкретного рантайма. */
  detectIssues?(ctx: ProbeContext): Promise<Issue[]>;
  /** Ожидание ввода пользователя (эвристика "ход завершён, файл не изменяется, процесс работает"). */
  awaitingInput?(ctx: ProbeContext): Promise<AwaitingInput | null>;
  /** История сессий; dirs - фильтр по рабочим папкам (пусто = все). */
  listSessions?(ctx: ProbeContext, dirs: string[]): Promise<SessionSummary[]>;
  /** Метаданные + текстовое превью одной сессии. */
  getSession?(ctx: ProbeContext, id: string): Promise<SessionDetail | null>;
  /**
   * Команда headless-ответа в сессию (spawn из консоли).
   * cwd передаётся отдельно (папка сессии, если известна).
   */
  replyCommand?(sessionId: string, text: string): { command: string; args: string[] } | null;
  /** Команда запуска НОВОЙ headless-сессии с промтом (для "Исправить" и запуска промтов). */
  runCommand?(text: string): { command: string; args: string[] } | null;
  /**
   * CLI умеет `--output-format json`: headless-вызов workflow печатает конверт
   * результата (текст, usage, стоимость), из которого движок извлекает статистику.
   */
  headlessJson?: boolean;
}

/** Навык/скрипт/агент, обнаруженный в рантайме (файлы не изменяются). */
export interface SkillItem {
  /** Стабильный идентификатор: <runtime>:<относительный путь>. */
  id: string;
  runtime: string;
  name: string;
  kind: "skill" | "plugin" | "agent" | "script";
  /** Происхождение: собственные каталоги рантайма или harness (.agents/skills). */
  origin: "runtime" | "harness";
  /** Путь для отображения (с ~). */
  source: string;
  description?: string;
}

export interface SessionSummary {
  id: string;
  runtime: string;
  startedAt?: string;
  lastActivityAt: string;
  workspaceDir?: string;
  titleHint?: string;
  sizeBytes: number;
  turns?: number;
  /** Можно ли ответить в сессию из консоли (headless resume). */
  resumable: boolean;
  /** Метрики из индекса сессий (sessions.sqlite); отсутствие - сессия ещё не собрана индексом. */
  metrics?: SessionMetrics;
}

/** Накопленные метрики сессии из индекса (токены, стоимость, длительность). */
export interface SessionMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  /** Оценка стоимости по каталогу цен, USD. */
  costUsd: number;
  /** Доля токенов, покрытых ценой каталога (0..1). */
  pricingCoverage: number;
  /** last_activity_at - started_at; 0 при неизвестном начале. */
  durationMs: number;
  models: string[];
  messageCount: number;
  toolCount: number;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  text: string;
  ts?: string;
}

export interface SessionDetail {
  summary: SessionSummary;
  excerpt: SessionMessage[];
  /** Путь к файлу сессии (с ~) - полные данные остаются там. */
  file: string;
}

export interface Issue {
  severity: "error" | "warn" | "info";
  title: string;
  detail?: string;
  hint?: string;
}

export interface AwaitingInput {
  sessionId: string;
  since: string;
  question?: string;
}

/** Транспорт MCP-сервера. */
export type McpTransport =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

/** Запись в глобальном реестре MCP консоли. */
export interface McpServerDef {
  name: string;
  transport: McpTransport;
  /** Начальная (глобальная) настройка. */
  enabled: boolean;
  /** Override для пользовательских конфигов конкретных рантаймов. */
  runtimeOverrides?: Record<string, boolean>;
  /** Хуки жизненного цикла (install/remove/enable/disable); cwd - обязательная рабочая папка. */
  hooks?: import("./lifecycleHooks").LifecycleHooks;
}

export interface TargetSyncResult {
  target: string;
  label: string;
  runtimes: string[];
  ok: boolean;
  at: string;
  applied: string[];
  removed: string[];
  error?: string;
}

/** Урезанные данные vendor-конфига, уезжающие в UI. */
export interface VendorCard {
  id: string;
  vendorAdapter: string;
  hooksSupport: string;
  capabilities: Record<string, string>;
  models: { tier: string; model: string; thinkingLevel: string; verified: boolean }[];
  permissions: {
    fsRead?: boolean;
    fsWrite?: boolean;
    gitCommit?: boolean;
    gitPush?: boolean;
    gitForcePush?: boolean;
    shell?: string;
  };
}

/** DTO поверх провба: все даты - ISO-строки. */
export interface RuntimeSnapshotDTO {
  id: string;
  displayName: string;
  adapterKind: "signals" | "generic";
  status: ActivityStatus;
  vendor: VendorCard | null;
  signals: { at: string; scope: ActivityScope; source: string }[];
  processes: ProcessInfo[];
  issues: Issue[];
  awaiting: AwaitingInput | null;
  probeError?: string;
}

export interface DashboardDataDTO {
  generatedAt: string;
  repoRoot: string;
  recentWindowMs: number;
  /** Рантайм по умолчанию для запуска промтов (★), null - не выбран. */
  defaultRuntime: string | null;
  guardActivity: { at: string; source: string } | null;
  runtimes: RuntimeSnapshotDTO[];
}
