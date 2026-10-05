import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { hasRuntimeConfig, loadRuntimePaths } from "@/core/runtimePaths";
import {
  internalSkillManifestSchema,
  roleFrontmatterSchema,
  workflowStepSchema,
  workflowSchema,
  type InternalSkillManifest,
  type RoleFrontmatter,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./schema";

export interface CatalogEntry<T> {
  value: T;
  sourceFile: string;
  etag: string;
  yaml: string;
  scope: "harness" | "workspace";
}

export interface WorkflowValidation {
  ok: boolean;
  errors: string[];
  workflow?: WorkflowDefinition;
}

/** Роль из каталога: frontmatter + markdown-тело + папка внутри .agents/roles. */
export interface RoleCatalogEntry {
  value: RoleFrontmatter;
  folder: string;
  body: string;
  /** Исходный текст файла целиком (frontmatter + тело). */
  text: string;
  sourceFile: string;
  etag: string;
}

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Ошибка конкурентного изменения файла: роуты переводят её в HTTP 409 с текущим текстом. */
function etagConflict(current: string): Error {
  const error = new Error("файл изменён вне Console") as Error & { code?: string; current?: string; etag?: string };
  error.code = "ETAG_CONFLICT";
  error.current = current;
  error.etag = digest(current);
  return error;
}

async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", content, "utf8");
  await rename(file + ".tmp", file);
}

/** Имя файла - один сегмент внутри .agents/<folder>: без разделителей пути и "..". */
function assertSafeFileName(fileName: string): void {
  const valid = /^[a-z0-9][a-z0-9._-]*\.ya?ml$/.test(fileName) && !fileName.includes("..") && !/[/\\]/.test(fileName);
  if (!valid) throw new Error("недопустимое имя YAML-файла");
}

/** Папка внутри .agents/roles: сегменты [a-z0-9._-], без "..". Пустая строка - корень. */
function assertSafeFolderPath(folder: string): void {
  if (folder === "") return;
  const valid = folder.split(/[\\/]/).every((segment) => /^[a-z0-9][a-z0-9._-]*$/.test(segment)) && !folder.includes("..");
  if (!valid) throw new Error("недопустимая папка ролей: " + folder);
}

/** Разрезает markdown-файл роли на frontmatter и тело. */
export function splitRoleFile(text: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: text };
  const frontmatter = (YAML.parse(text.slice(4, end)) ?? {}) as Record<string, unknown>;
  return { frontmatter, body: text.slice(end + 5) };
}

export function serializeRoleFile(frontmatter: Record<string, unknown>, body: string): string {
  return "---\n" + YAML.stringify(frontmatter, { lineWidth: 0 }) + "---\n\n" + body.replace(/^\n+/, "");
}

async function filesIn(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith(".yaml") || name.endsWith(".yml")).sort().map((name) => path.join(dir, name));
}

async function readYamlEntry<T>(
  file: string,
  scope: CatalogEntry<T>["scope"],
  parse: (value: unknown) => T,
): Promise<CatalogEntry<T>> {
  const yaml = await readFile(file, "utf8");
  return { value: parse(YAML.parse(yaml)), sourceFile: file, etag: digest(yaml), yaml, scope };
}

/** Все .md-файлы ролей в .agents/roles, рекурсивно, с относительной папкой. */
async function roleFiles(root: string): Promise<Array<{ file: string; folder: string }>> {
  const base = path.join(root, ".agents", "roles");
  const out: Array<{ file: string; folder: string }> = [];
  const walk = async (dir: string, folder: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), folder ? folder + "/" + entry.name : entry.name);
      else if (entry.name.endsWith(".md")) out.push({ file: path.join(dir, entry.name), folder });
    }
  };
  await walk(base, "");
  return out;
}

/** Каталог ролей: один файл = одна роль. Повреждённые файлы пропускаются. */
export async function loadRoles(root: string): Promise<RoleCatalogEntry[]> {
  const result: RoleCatalogEntry[] = [];
  for (const { file, folder } of await roleFiles(root)) {
    try {
      const text = await readFile(file, "utf8");
      const { frontmatter, body } = splitRoleFile(text);
      result.push({ value: roleFrontmatterSchema.parse(frontmatter), folder, body, text, sourceFile: file, etag: digest(text) });
    } catch {
      // Повреждённый файл роли не попадает в каталог.
    }
  }
  return result;
}

export function parseRoleFile(text: string): RoleFrontmatter {
  const { frontmatter, body } = splitRoleFile(text);
  const value = roleFrontmatterSchema.parse(frontmatter);
  if (!body.trim()) throw new Error("файл роли без markdown-тела: " + value.id);
  return value;
}

export async function saveRoleFile(opts: {
  root: string;
  folder: string;
  id: string;
  text: string;
  expectedEtag?: string;
}): Promise<{ etag: string; fileName: string }> {
  assertSafeFolderPath(opts.folder);
  parseRoleFile(opts.text);
  const file = roleFilePath(opts.root, opts.folder, opts.id);
  const current = await readFile(file, "utf8").catch(() => "");
  if (opts.expectedEtag !== undefined && opts.expectedEtag !== "" && digest(current) !== opts.expectedEtag) throw etagConflict(current);
  await writeFileAtomic(file, opts.text.endsWith("\n") ? opts.text : opts.text + "\n");
  return { etag: digest(opts.text), fileName: path.basename(file) };
}

function roleFilePath(root: string, folder: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id.includes("..")) throw new Error("недопустимый идентификатор роли: " + id);
  assertSafeFolderPath(folder);
  return path.join(root, ".agents", "roles", folder, id + ".md");
}

const ROLE_BODY_SECTIONS = [
  "# Роль",
  "<Назначение и границы ответственности.>",
  "",
  "## Правила работы",
  "<Типовые работы и пошаговые алгоритмы; какие навыки, MCP и инструменты применяются на каждом шаге.>",
  "",
  "## Принципы работы",
  "<Как действовать, если задача не подходит ни под один алгоритм из правил.>",
  "",
  "## Оценка входных данных",
  "<Критерии проверки входных артефактов: полнота, противоречия, что вернуть поставщику.>",
  "",
  "## Оценка своей работы",
  "<Критерии самооценки результата до завершения шага.>",
  "",
];

export async function createRole(opts: { root: string; folder: string; id: string; title?: string }): Promise<{ etag: string; fileName: string }> {
  const roles = await loadRoles(opts.root);
  if (roles.some((role) => role.value.id === opts.id)) throw new Error("роль с таким ID уже существует: " + opts.id);
  const frontmatter = roleFrontmatterSchema.parse({
    apiVersion: "harness/v1",
    kind: "Role",
    id: opts.id,
    title: opts.title?.trim() || opts.id,
    skills: [],
    mcp: [],
    tools: [],
  });
  const text = serializeRoleFile(frontmatter, ROLE_BODY_SECTIONS.join("\n"));
  await writeFileAtomic(roleFilePath(opts.root, opts.folder, opts.id), text);
  return { etag: digest(text), fileName: opts.id + ".md" };
}

export async function deleteRole(opts: { root: string; folder: string; id: string; expectedEtag?: string }): Promise<void> {
  const file = roleFilePath(opts.root, opts.folder, opts.id);
  const current = await readFile(file, "utf8").catch(() => null);
  if (current === null) throw new Error("роль не найдена: " + opts.id);
  if (opts.expectedEtag !== undefined && opts.expectedEtag !== "" && digest(current) !== opts.expectedEtag) throw etagConflict(current);
  await unlink(file);
}

function mergeObject(base: unknown, overlay: unknown): unknown {
  if (Array.isArray(overlay)) return overlay;
  if (!overlay || typeof overlay !== "object") return overlay;
  const out: Record<string, unknown> =
    base && typeof base === "object" && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    out[key] = mergeObject(out[key], value);
  }
  return out;
}

function mergeNodes(base: WorkflowStep[], overlay: WorkflowStep[]): WorkflowStep[] {
  const byId = new Map(base.map((node) => [node.id, node]));
  for (const node of overlay) {
    if (node.disabled) {
      byId.delete(node.id);
      continue;
    }
    const current = byId.get(node.id);
    byId.set(node.id, workflowStepSchema.parse(mergeObject(current, node)));
  }
  return [...byId.values()];
}

function mergeWorkflow(base: WorkflowDefinition, overlay: WorkflowDefinition): WorkflowDefinition {
  const merged = mergeObject(base, overlay) as WorkflowDefinition;
  merged.nodes = mergeNodes(base.nodes, overlay.nodes);
  return workflowSchema.parse(merged);
}

export function validateWorkflowGraph(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of workflow.nodes) {
    if (ids.has(node.id)) errors.push("дублирующийся узел: " + node.id);
    ids.add(node.id);
  }
  for (const node of workflow.nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) errors.push("узел " + node.id + ": зависимость " + dep + " не найдена");
      if (dep === node.id) errors.push("узел " + node.id + ": зависимость на самого себя");
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const visit = (id: string, chain: string[]) => {
    if (visiting.has(id)) {
      errors.push("цикл DAG: " + [...chain, id].join(" -> "));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) visit(dep, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id, []);
  if (workflow.nodes.length > 1) {
    const incoming = new Set(workflow.nodes.flatMap((node) => node.dependsOn));
    for (const node of workflow.nodes) {
      if (!incoming.has(node.id) && node.dependsOn.length === 0) errors.push("узел " + node.id + " не соединён с другими узлами");
    }
  }
  return [...new Set(errors)];
}

/** Каталоги определений workflow корня: workflowsRoot из конфига, затем legacy .agents/workflows. */
async function harnessWorkflowDirs(root: string): Promise<string[]> {
  const paths = await loadRuntimePaths(root);
  const primary = path.join(root, paths.workflowsRoot);
  const legacy = path.join(root, ".agents", "workflows");
  return path.resolve(primary) === path.resolve(legacy) ? [primary] : [primary, legacy];
}

/** Переименование workflow: ссылки extends во всех файлах обеих областей переводятся на новый id. */
export async function renameWorkflowRefs(opts: { harnessRoot: string; workspaceRoot?: string; oldId: string; newId: string }): Promise<number> {
  const roots = [opts.harnessRoot, ...(opts.workspaceRoot && path.resolve(opts.workspaceRoot) !== path.resolve(opts.harnessRoot) ? [opts.workspaceRoot] : [])];
  let updated = 0;
  for (const root of roots) {
    const dirs = path.resolve(root) === path.resolve(opts.harnessRoot) ? await harnessWorkflowDirs(root) : [path.join(root, ".agents", "workflows")];
    const files = (await Promise.all(dirs.map((dir) => filesIn(dir)))).flat();
    for (const file of files) {
      const text = await readFile(file, "utf8").catch(() => "");
      if (!text) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        const value = YAML.parse(text);
        if (value && typeof value === "object") parsed = value as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed?.extends !== opts.oldId) continue;
      const normalized = YAML.stringify({ ...parsed, extends: opts.newId }, { lineWidth: 0 });
      await writeFileAtomic(file, normalized);
      updated += 1;
    }
  }
  return updated;
}

async function loadRawWorkflows(root: string, scope: CatalogEntry<WorkflowDefinition>["scope"]) {
  const dirs = scope === "harness" ? await harnessWorkflowDirs(root) : [path.join(root, ".agents", "workflows")];
  const files = [...new Set((await Promise.all(dirs.map((dir) => filesIn(dir)))).flat())];
  const out: CatalogEntry<WorkflowDefinition>[] = [];
  for (const file of files) {
    try {
      out.push(await readYamlEntry(file, scope, (value) => workflowSchema.parse(value)));
    } catch {
      // Повреждённый или устаревший файл не ломает весь каталог.
    }
  }
  return out;
}

export async function loadWorkflowCatalog(
  harnessRoot: string,
  workspaceRoot?: string,
): Promise<Map<string, CatalogEntry<WorkflowDefinition>>> {
  const harness = await loadRawWorkflows(harnessRoot, "harness");
  const workspace =
    workspaceRoot && path.resolve(workspaceRoot) !== path.resolve(harnessRoot)
      ? await loadRawWorkflows(workspaceRoot, "workspace")
      : [];
  const raw = new Map<string, CatalogEntry<WorkflowDefinition>>();
  for (const item of [...harness, ...workspace]) raw.set(item.value.id, item);

  const resolved = new Map<string, CatalogEntry<WorkflowDefinition>>();
  const resolving = new Set<string>();
  const resolve = (id: string): CatalogEntry<WorkflowDefinition> => {
    const cached = resolved.get(id);
    if (cached) return cached;
    if (resolving.has(id)) throw new Error("цикл наследования workflow: " + [...resolving, id].join(" -> "));
    const item = raw.get(id);
    if (!item) throw new Error("workflow не найден: " + id);
    resolving.add(id);
    let value = item.value;
    if (value.extends) value = mergeWorkflow(resolve(value.extends).value, value);
    const graphErrors = validateWorkflowGraph(value);
    if (graphErrors.length) throw new Error(graphErrors.join("; "));
    resolving.delete(id);
    const entry = { ...item, value };
    resolved.set(id, entry);
    return entry;
  };
  for (const id of raw.keys()) resolve(id);
  return resolved;
}

export function parseWorkflowYaml(yaml: string): WorkflowValidation {
  try {
    const workflow = workflowSchema.parse(YAML.parse(yaml));
    const errors = validateWorkflowGraph(workflow);
    return errors.length ? { ok: false, errors } : { ok: true, errors: [], workflow };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export async function saveWorkflowYaml(opts: {
  root: string;
  fileName: string;
  yaml: string;
  folder?: string;
  expectedEtag?: string;
}): Promise<CatalogEntry<WorkflowDefinition>> {
  const validated = parseWorkflowYaml(opts.yaml);
  if (!validated.ok || !validated.workflow) throw new Error(validated.errors.join("; "));
  assertSafeFileName(opts.fileName);
  const dir = opts.folder
    ? path.join(opts.root, ".agents", opts.folder)
    : hasRuntimeConfig(opts.root)
      ? path.join(opts.root, (await loadRuntimePaths(opts.root)).workflowsRoot)
      : path.join(opts.root, ".agents", "workflows");
  const file = path.join(dir, opts.fileName);
  if (!file.startsWith(dir + path.sep)) throw new Error("недопустимое имя YAML-файла");
  const current = await readFile(file, "utf8").catch(() => "");
  if (opts.expectedEtag !== undefined && digest(current) !== opts.expectedEtag) throw etagConflict(current);
  const normalized = YAML.stringify(validated.workflow, { lineWidth: 0 });
  await writeFileAtomic(file, normalized);
  return { value: validated.workflow, sourceFile: file, etag: digest(normalized), yaml: normalized, scope: "workspace" };
}

/** Группа внутреннего каталога: master - общий, design - дизайн-навыки. */
export type InternalSkillGroup = "master" | "design";

/** Внутренние навыки: privateSkillRoot (мастер-каталог), designSkillRoot (группа design),
 * затем legacy .agents/skills (master). Повтор id манифеста в корнях - берётся первый. */
export async function loadInternalSkills(root: string): Promise<Array<CatalogEntry<InternalSkillManifest> & { content: string; group: InternalSkillGroup }>> {
  const paths = await loadRuntimePaths(root);
  const roots: Array<{ base: string; group: InternalSkillGroup }> = [
    { base: path.join(root, paths.privateSkillRoot), group: "master" },
    { base: path.join(root, paths.designSkillRoot), group: "design" },
    { base: path.join(root, ".agents", "skills"), group: "master" },
  ];
  const result: Array<CatalogEntry<InternalSkillManifest> & { content: string; group: InternalSkillGroup }> = [];
  const seen = new Set<string>();
  for (const { base, group } of roots) {
    const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const entry = await readYamlEntry(
          path.join(base, dir.name, "manifest.yaml"),
          "harness",
          (value) => internalSkillManifestSchema.parse(value),
        );
        if (seen.has(entry.value.id)) continue;
        const content = await readFile(path.join(base, dir.name, "SKILL.md"), "utf8");
        seen.add(entry.value.id);
        result.push({ ...entry, content, group });
      } catch {
        // Повреждённый пакет не попадает в доступный каталог.
      }
    }
  }
  return result;
}

export function partialNodeClosure(workflow: WorkflowDefinition, targetIds: string[], completed = new Set<string>()): string[] {
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const selected = new Set<string>();
  const visit = (id: string) => {
    if (completed.has(id) || selected.has(id)) return;
    const node = byId.get(id);
    if (!node) throw new Error("узел не найден: " + id);
    for (const dep of node.dependsOn) visit(dep);
    selected.add(id);
  };
  for (const id of targetIds) visit(id);
  return workflow.nodes.filter((node) => selected.has(node.id)).map((node) => node.id);
}

export function workflowNodeRange(workflow: WorkflowDefinition, startId?: string, endId?: string): string[] {
  const startIndex = startId ? workflow.nodes.findIndex((node) => node.id === startId) : 0;
  const endIndex = endId ? workflow.nodes.findIndex((node) => node.id === endId) : workflow.nodes.length - 1;
  if (startIndex < 0) throw new Error("начальный узел не найден: " + startId);
  if (endIndex < 0) throw new Error("конечный узел не найден: " + endId);
  if (startIndex > endIndex) throw new Error("начальный узел должен находиться раньше конечного");
  return workflow.nodes.slice(startIndex, endIndex + 1).map((node) => node.id);
}
