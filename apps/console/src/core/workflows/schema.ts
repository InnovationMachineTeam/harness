import { z } from "zod";

export const WORKFLOW_API_VERSION = "harness/v1" as const;
export const MODEL_TIERS = ["fast", "standard", "strong", "subagents"] as const;
export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;
export const WORKSPACE_MODES = ["read", "write", "worktree"] as const;
export const CAPABILITY_POLICIES = ["block", "warn"] as const;

const stringList = z.array(z.string().min(1)).default([]);

/** Frontmatter файла роли `.agents/roles/<папка>/<id>.md`. */
export const roleFrontmatterSchema = z.object({
  apiVersion: z.literal(WORKFLOW_API_VERSION),
  kind: z.literal("Role"),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  title: z.string().min(1),
  domain: z.string().min(1).optional(),
  skills: stringList,
  mcp: stringList,
  tools: stringList,
  defaultTier: z.enum(MODEL_TIERS).optional(),
  defaultEffort: z.enum(EFFORT_LEVELS).optional(),
});
export type RoleFrontmatter = z.infer<typeof roleFrontmatterSchema>;

/** Входной контроль шага: проверка входа по DoR до взятия в работу. */
export const inputControlSchema = z.object({
  roles: stringList,
  prompt: z.string().default(""),
  dor: stringList,
  maxAttempts: z.number().int().min(1).max(50).default(10),
});

/** Исполнение шага: план по DoD/AC и работа ролей-исполнителей. */
export const executionSectionSchema = z.object({
  prompt: z.string().default(""),
  confirmPlan: z.boolean().default(false),
  /** Финальный ```json список задач из ответа попадает в backlog roadmap. */
  producesTasks: z.boolean().default(false),
});

/** Выходной контроль шага: чек-лист тестов, ревью по DoD/AC, ручная приёмка. */
export const outputControlSchema = z.object({
  roles: stringList,
  tests: stringList,
  dod: stringList,
  /** Статические AC как override; пустой список - AC генерирует движок из outputs, execution.prompt, description и DoD. */
  ac: stringList,
  manualReview: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(50).default(10),
});

export const workflowStepSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  title: z.string().min(1),
  phase: z.string().min(1),
  description: z.string().default(""),
  dependsOn: stringList,
  roles: stringList,
  runtime: z.object({
    candidates: stringList,
    tier: z.enum(MODEL_TIERS).optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
  }),
  inputControl: inputControlSchema.optional(),
  execution: executionSectionSchema,
  outputControl: outputControlSchema.optional(),
  inputs: stringList,
  outputs: stringList,
  timeoutMs: z.number().int().min(1_000).max(86_400_000).default(900_000),
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(3),
  }).default({ maxAttempts: 3 }),
  resources: z.object({
    workspace: z.enum(WORKSPACE_MODES).default("read"),
  }).default({ workspace: "read" }),
  disabled: z.boolean().optional(),
  /** Служебный шаг спринта: sprint-worktrees | sprint-bucket | sprint-close | sprint-retrospective. */
  kind: z.string().optional(),
  /** Служебный шаг не отображается в списке шагов прогона. */
  hidden: z.boolean().optional(),
  /** Номер параллельной корзины спринта. */
  bucket: z.number().int().optional(),
  ui: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const workflowSchema = z.object({
  apiVersion: z.literal(WORKFLOW_API_VERSION),
  kind: z.literal("Workflow"),
  id: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
  title: z.string().min(1),
  description: z.string().default(""),
  extends: z.string().min(1).optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  defaults: z.object({
    privacy: z.enum(["full", "metadata", "aggregates"]).default("metadata"),
    capabilityPolicy: z.enum(CAPABILITY_POLICIES).optional(),
    /** Runtime-кандидаты по умолчанию: шаги с пустым списком наследуют этот порядок (CLI или "provider:<id>"). */
    runtime: z.object({
      candidates: stringList,
    }).optional(),
  }).default({ privacy: "metadata" }),
  nodes: z.array(workflowStepSchema).max(100),
  /** Замороженное разрешение прогона: содержимое ролей и навыков на момент старта. */
  resolution: z.object({
    at: z.string().datetime(),
    capabilityPolicy: z.enum(CAPABILITY_POLICIES).default("block"),
    unavailableCapabilities: z.array(z.object({
      kind: z.enum(["skill", "mcp", "tool"]),
      id: z.string(),
      roleId: z.string(),
      stepId: z.string(),
      reason: z.string(),
    })).default([]),
    roles: z.record(z.string(), z.object({
      hash: z.string(), content: z.string(), title: z.string().optional(),
      skills: stringList, mcp: stringList, tools: stringList,
      defaultTier: z.enum(MODEL_TIERS).optional(),
      defaultEffort: z.enum(EFFORT_LEVELS).optional(),
    })).default({}),
    skills: z.record(z.string(), z.object({ version: z.string(), hash: z.string(), content: z.string() })),
    runtimes: z.record(z.string(), z.object({
      configHash: z.string(),
      models: z.record(z.string(), z.object({ model: z.string(), thinkingLevel: z.string().default(""), verified: z.boolean().optional() })),
    })).default({}),
  }).optional(),
});

/** Хуки жизненного цикла внутреннего навыка: shell-команды, cwd = каталог навыка. */
export const internalSkillHooksSchema = z.object({
  install: stringList,
  remove: stringList,
  enable: stringList,
  disable: stringList,
});

export const internalSkillManifestSchema = z.object({
  apiVersion: z.literal(WORKFLOW_API_VERSION),
  kind: z.literal("InternalSkill"),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  source: z.object({
    url: z.string().url().optional(),
    version: z.string().min(1),
    hash: z.string().min(1),
    update: z.literal("manual-review"),
  }),
  runtimes: stringList,
  tags: stringList,
  /** Опциональные хуки; исполняются консолью в обязательной рабочей папке после guard-проверки. */
  hooks: internalSkillHooksSchema.optional(),
});

export const roadmapStatuses = ["inbox", "ready", "in-progress", "blocked", "review", "done", "archived"] as const;
export const roadmapItemSchema = z.object({
  apiVersion: z.literal(WORKFLOW_API_VERSION),
  kind: z.literal("RoadmapItem"),
  id: z.string().regex(/^[A-Z0-9][A-Z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().default(""),
  type: z.enum(["feature", "bug", "debt", "research", "risk", "task"]),
  status: z.enum(roadmapStatuses),
  priority: z.enum(["low", "normal", "high", "critical"]),
  /** Оценка из планирования PDLC: ценность и трудозатраты (шкала 1-5). */
  estimate: z.object({
    value: z.number().optional(),
    effort: z.number().optional(),
  }).optional(),
  domain: z.string().min(1).optional(),
  specialization: z.string().min(1).optional(),
  labels: stringList,
  dependencies: stringList,
  acceptanceCriteria: stringList,
  workflowId: z.string().optional(),
  runIds: stringList,
  taskRefs: stringList,
  provenance: z.object({
    source: z.string().min(1),
    runId: z.string().optional(),
    fingerprint: z.string().optional(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type InputControl = z.infer<typeof inputControlSchema>;
export type ExecutionSection = z.infer<typeof executionSectionSchema>;
export type OutputControl = z.infer<typeof outputControlSchema>;
export type RoadmapItem = z.infer<typeof roadmapItemSchema>;
export type InternalSkillManifest = z.infer<typeof internalSkillManifestSchema>;
export type PrivacyMode = WorkflowDefinition["defaults"]["privacy"];
