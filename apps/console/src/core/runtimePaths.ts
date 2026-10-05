import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Пути каталогов harness из .agents/runtime/config.json.
 * Значения конфига относительны корню репозитория; отсутствующий ключ
 * заменяется значением по умолчанию. Конфиг есть только в корне репозитория:
 * для рабочих папок используйте legacy-пути (.agents/...).
 */
export interface RuntimePaths {
  /** Корни публичных навыков (установка через skills.sh). */
  publicSkills: string[];
  /** Внутренние навыки: каталоги с manifest.yaml + SKILL.md. */
  privateSkillRoot: string;
  /** Группа навыков design (та же механика, что master; label "design"). */
  designSkillRoot: string;
  /** Определения workflow harness (YAML). */
  workflowsRoot: string;
}

const DEFAULT_PATHS: RuntimePaths = {
  publicSkills: [".agents/skills"],
  privateSkillRoot: ".agents/skills/master/skills",
  designSkillRoot: ".agents/skills/design/skills",
  workflowsRoot: ".agents/skills/master/workflows",
};

/** Признак корня репозитория harness: наличие .agents/runtime/config.json. */
export function hasRuntimeConfig(dir: string): boolean {
  return existsSync(join(dir, ".agents", "runtime", "config.json"));
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") && value.length > 0
    ? (value as string[])
    : null;
}

export async function loadRuntimePaths(repoRoot: string): Promise<RuntimePaths> {
  const configPath = join(repoRoot, ".agents", "runtime", "config.json");
  const raw = await readFile(configPath, "utf8").catch(() => null);
  if (!raw) return { ...DEFAULT_PATHS };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_PATHS };
  }
  return {
    publicSkills: asStringArray(parsed.publicSkills) ?? DEFAULT_PATHS.publicSkills,
    privateSkillRoot: typeof parsed.privateSkillRoot === "string" ? parsed.privateSkillRoot : DEFAULT_PATHS.privateSkillRoot,
    designSkillRoot: typeof parsed.designSkillRoot === "string" ? parsed.designSkillRoot : DEFAULT_PATHS.designSkillRoot,
    workflowsRoot: typeof parsed.workflowsRoot === "string" ? parsed.workflowsRoot : DEFAULT_PATHS.workflowsRoot,
  };
}

/** Абсолютные корни публичных навыков репозитория (по порядку из конфига). */
export function publicSkillDirs(repoRoot: string, paths: RuntimePaths): string[] {
  return [...new Set(paths.publicSkills.map((rel) => join(repoRoot, rel)))];
}
