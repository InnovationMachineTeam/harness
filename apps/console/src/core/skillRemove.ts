import { spawn } from "node:child_process";
import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Удаление установленного harness-навыка: `bunx skills remove <name> -y`
 * (чистит .agents/skills/<name>, записи skills-lock.json и симлинки в
 * каталогах агентов). Если CLI не справился - ручная зачистка тех же мест.
 */

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
const REMOVE_TIMEOUT_MS = 60_000;

/** Каталоги навыков агентов в репозитории (симлинки из universal .agents/skills). */
const AGENT_SKILL_DIRS = [".claude/skills", ".cursor/skills", ".codex/skills", ".opencode/skills", ".zcode/skills"];

export function isValidSkillSlug(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name);
}

export interface RemoveResult {
  ok: boolean;
  detail: string;
  output: string;
}

function runRemoveCli(repoRoot: string, name: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("bunx", ["skills", "remove", name, "-y"], {
      cwd: repoRoot,
      env: { ...process.env, DISABLE_TELEMETRY: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString("utf8").replace(ANSI_RE, "");
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* уже завершён */
      }
    }, REMOVE_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.slice(-4_000) });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: String(err) });
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** Ручная зачистка: каталог навыка, lock-файл, симлинки агентов. */
async function manualCleanup(repoRoot: string, name: string): Promise<void> {
  await rm(path.join(repoRoot, ".agents", "skills", name), { recursive: true, force: true });
  for (const dir of AGENT_SKILL_DIRS) {
    await rm(path.join(repoRoot, dir, name), { recursive: true, force: true });
  }
  const lockPath = path.join(repoRoot, "skills-lock.json");
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as { skills?: Record<string, unknown> };
    if (lock.skills && name in lock.skills) {
      delete lock.skills[name];
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    }
  } catch {
    /* lock-файл отсутствует или повреждён - не критично */
  }
}

export async function removeHarnessSkill(repoRoot: string, name: string): Promise<RemoveResult> {
  if (!isValidSkillSlug(name)) {
    return { ok: false, detail: "недопустимое имя навыка", output: "" };
  }
  const skillDir = path.join(repoRoot, ".agents", "skills", name);
  if (!(await pathExists(skillDir))) {
    return { ok: false, detail: `навык не найден: ${name}`, output: "" };
  }

  const cli = await runRemoveCli(repoRoot, name);
  let gone = !(await pathExists(skillDir));
  if (!gone) {
    await manualCleanup(repoRoot, name);
    gone = !(await pathExists(skillDir));
  }

  return {
    ok: gone,
    detail: gone ? `навык ${name} удалён (.agents/skills, lock-файл, симлинки агентов)` : `не удалось удалить ${name}`,
    output: cli.output,
  };
}
